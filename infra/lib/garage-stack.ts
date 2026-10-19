// infra/lib/garage-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess
} from 'aws-cdk-lib/aws-s3';
import {
  Distribution,
  ViewerProtocolPolicy,
  AllowedMethods,
  CachePolicy,
  ResponseHeadersPolicy,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  SecurityPolicyProtocol,
  Function,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  type BehaviorOptions,
  type ICachePolicy,
  type IResponseHeadersPolicy
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import * as path from 'path';
import { discoverSpaRoutes } from './spa-routes';
import { viewerRequestCode } from './viewer-request';

export interface GarageStackProps extends cdk.StackProps {
  domainName?: string;
  certificateArn?: string;
  /** Hosted zone holding the records. Defaults to domainName. */
  zoneName?: string;
  /** Serve and redirect www.<domainName>. Defaults to true (production). */
  includeWww?: boolean;
  /** Send X-Robots-Tag: noindex, nofollow on every response (staging). */
  noindex?: boolean;
  /** Firebase project the CSP allows for auth and functions. */
  firebaseProjectId?: string;
}

/**
 * Viewer-request function. Routes come from app/src/routes (see spa-routes.ts).
 * - www.gaslandsgarage.com → 301 to the apex, same path and query.
 * - `/` and `/index.html` → 301 to `/builder` (keeps ?draft= and ?open=).
 * - Each SvelteKit page, and a parent such as `/admin`, is rewritten to
 *   `/index.html`. Query strings stay on the browser URL.
 * - File names are left alone, so assets, robots.txt, sitemap.xml, and PDFs
 *   are still the S3 objects. Any other missing path 403s from the private
 *   bucket, and CloudFront turns that into a real 404.
 */
const spaRoutes = discoverSpaRoutes(path.join(__dirname, '../../app/src/routes'));
for (const required of ['/builder', '/stats', '/admin/users', '/privacy', '/terms']) {
  if (!spaRoutes.includes(required)) {
    throw new Error(
      `Viewer function is missing ${required}. Refusing to publish a function that would 404 it.`
    );
  }
}

export class GarageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: GarageStackProps) {
    super(scope, id, props);
    
    // Define domain name
    const domainName = props?.domainName || 'gaslandsgarage.com';
    const zoneName = props?.zoneName ?? domainName;
    const includeWww = props?.includeWww !== false;
    const firebaseProjectId = props?.firebaseProjectId ?? 'gaslandsgarage-74ce6';
    if (!/^[a-z0-9-]+$/.test(firebaseProjectId)) {
      throw new Error(`Invalid Firebase project id: ${firebaseProjectId}`);
    }

    /* ----------------------------------------------------------------
       S3 bucket for the static site.

       The bucket is private. CloudFront reads it with Origin Access
       Control. It is not a website endpoint: those cannot use OAC, and
       they require a public read policy.

       BlockPublicPolicy is NOT set on the bucket resource itself. This
       bucket already has a public GetObject policy. S3 rejects a public
       access block while that policy still exists, and CloudFormation
       updates the bucket before it replaces the policy. A custom resource
       below applies the full block only after the policy is OAC-only.
       ---------------------------------------------------------------- */
    const siteBucket = new Bucket(this, 'SiteBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: new BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false
      }),
      removalPolicy: RemovalPolicy.DESTROY,   // dev-friendly cleanup
      autoDeleteObjects: true
    });

    const hsts = {
      accessControlMaxAge: cdk.Duration.days(365),
      includeSubdomains: true,
      preload: false,
      override: true
    };

    // Inline scripts in app.html need 'unsafe-inline'. frame-ancestors and
    // X-Frame-Options still stop the settings modal from being framed.
    const contentSecurityPolicy = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.gstatic.com https://maps.googleapis.com https://maps.gstatic.com https://apis.google.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://tile.openstreetmap.org https://*.basemaps.cartocdn.com https://www.google-analytics.com https://www.googletagmanager.com https://maps.gstatic.com https://maps.googleapis.com https://mirrors.creativecommons.org",
      "font-src 'self' data:",
      `connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://nominatim.openstreetmap.org https://maps.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebasestorage.googleapis.com https://firebase.googleapis.com https://firebaseinstallations.googleapis.com https://www.googleapis.com https://${firebaseProjectId}.firebaseapp.com https://us-central1-${firebaseProjectId}.cloudfunctions.net wss://*.firebaseio.com`,
      `frame-src 'self' https://${firebaseProjectId}.firebaseapp.com https://accounts.google.com https://apis.google.com https://www.youtube.com https://www.youtube-nocookie.com`,
      "worker-src 'self' blob:",
      "manifest-src 'self'"
    ].join('; ');

    const securityHeaders = {
      strictTransportSecurity: hsts,
      contentTypeOptions: { override: true },
      frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
      referrerPolicy: {
        referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
        override: true
      },
      contentSecurityPolicy: { contentSecurityPolicy, override: true }
    };

    const permissionsPolicy = {
      header: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      override: true
    };
    const robotsHeaders = props?.noindex
      ? [{ header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true }]
      : [];

    const htmlHeaders = new ResponseHeadersPolicy(this, 'HtmlHeaders', {
      comment: 'index.html and app routes must revalidate. Hashed files are a separate behavior and stay cached.',
      securityHeadersBehavior: securityHeaders,
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Cache-Control', value: 'no-cache', override: true },
          permissionsPolicy,
          ...robotsHeaders
        ]
      }
    });

    const immutableHeaders = new ResponseHeadersPolicy(this, 'ImmutableHeaders', {
      comment: 'SvelteKit content hashes change when the file changes.',
      securityHeadersBehavior: securityHeaders,
      customHeadersBehavior: {
        customHeaders: [{
          header: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
          override: true
        }, permissionsPolicy, ...robotsHeaders]
      }
    });

    const staticHeaders = new ResponseHeadersPolicy(this, 'StaticHeaders', {
      comment: 'Icons, images, robots.txt, and the sitemap.',
      securityHeadersBehavior: securityHeaders,
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Cache-Control', value: 'public, max-age=86400', override: true },
          permissionsPolicy,
          ...robotsHeaders
        ]
      }
    });

    const viewerRequest = new Function(this, 'ViewerRequest', {
      comment: 'Redirect www and / to the apex builder, and keep SPA routes on index.html.',
      code: FunctionCode.fromInline(viewerRequestCode(spaRoutes, {
        canonicalHost: domainName,
        redirectHost: includeWww ? `www.${domainName}` : ''
      })),
      runtime: FunctionRuntime.JS_2_0
    });

    const origin = S3BucketOrigin.withOriginAccessControl(siteBucket);
    const functionAssociations = [{
      function: viewerRequest,
      eventType: FunctionEventType.VIEWER_REQUEST
    }];

    const behavior = (
      cachePolicy: ICachePolicy,
      responseHeadersPolicy: IResponseHeadersPolicy
    ): BehaviorOptions => ({
      origin,
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      compress: true,
      cachePolicy,
      responseHeadersPolicy,
      functionAssociations
    });

    const staticBehavior = (): BehaviorOptions => behavior(CachePolicy.CACHING_OPTIMIZED, staticHeaders);

    /* ----------------------------------------------------------------
       Route53 hosted zone (use existing zone)
       ---------------------------------------------------------------- */
    // Look up the hosted zone for the domain
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: zoneName,
    });

    /* ----------------------------------------------------------------
       ACM Certificate for HTTPS
       ---------------------------------------------------------------- */
    // Either import the certificate or create a new one
    let siteCertificate;
    
    if (props?.certificateArn) {
      // Import existing certificate if ARN is provided
      siteCertificate = Certificate.fromCertificateArn(
        this, 
        'SiteCertificate', 
        props.certificateArn
      );
    } else {
      // Otherwise, try to get it from the context (for cross-region reference)
      const certificateArn = cdk.Fn.importValue('SiteCertificateArn');
      if (certificateArn) {
        siteCertificate = Certificate.fromCertificateArn(
          this, 
          'ImportedCertificate', 
          certificateArn
        );
      } else {
        // As a fallback, create a new certificate (this will only work in us-east-1)
        siteCertificate = new Certificate(this, 'SiteCertificate', {
          domainName: domainName,
          subjectAlternativeNames: includeWww ? [`www.${domainName}`] : undefined,
          validation: CertificateValidation.fromDns(hostedZone)
        });
      }
    }

    /* ----------------------------------------------------------------
       CloudFront distribution
       ---------------------------------------------------------------- */
    const cdn = new Distribution(this, 'CDN', {
      defaultRootObject: 'index.html',
      defaultBehavior: behavior(CachePolicy.CACHING_DISABLED, htmlHeaders),
      additionalBehaviors: {
        // Highest precedence first. Hashed bundles must not inherit HTML no-cache.
        '/_app/immutable/*': behavior(CachePolicy.CACHING_OPTIMIZED, immutableHeaders),
        '/images/*': staticBehavior(),
        '*.png': staticBehavior(),
        '*.svg': staticBehavior(),
        '*.ico': staticBehavior(),
        '*.webp': staticBehavior(),
        '*.webmanifest': staticBehavior(),
        '*.txt': staticBehavior(),
        '*.xml': staticBehavior()
      },
      domainNames: includeWww ? [domainName, `www.${domainName}`] : [domainName],
      certificate: siteCertificate,
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
          ttl: cdk.Duration.seconds(0)
        },
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
          ttl: cdk.Duration.seconds(0)
        }
      ],
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021
    });

    // OAC adds its statement while the distribution binds. Lock the bucket
    // only after that statement has replaced the public read policy.
    const bucketPolicy = siteBucket.policy;
    if (!bucketPolicy) {
      throw new Error('Origin Access Control did not attach a bucket policy');
    }
    const lockDown = lockBucketAfterPolicy(this, siteBucket.bucketName, siteBucket.bucketArn);
    lockDown.node.addDependency(bucketPolicy);
    
    /* ----------------------------------------------------------------
       Route53 DNS records
       ---------------------------------------------------------------- */
    // Create A record for apex domain (example.com)
    new route53.ARecord(this, 'SiteAliasRecord', {
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(cdn)
      ),
      zone: hostedZone
    });
    
    // www must keep resolving to this distribution so the viewer function can 301 it.
    if (includeWww) {
      new route53.CnameRecord(this, 'WWWRecord', {
        recordName: `www.${domainName}`,
        domainName: domainName,
        zone: hostedZone
      });
    }

    /* ----------------------------------------------------------------
       Outputs
       ---------------------------------------------------------------- */
    new cdk.CfnOutput(this, 'BucketName', {
      value: siteBucket.bucketName
    });

    new cdk.CfnOutput(this, 'CDNDistributionDomainName', {
      value: cdn.domainName
    });
    
    new cdk.CfnOutput(this, 'CustomDomain', {
      value: `https://${domainName}`
    });
    
    if (includeWww) {
      new cdk.CfnOutput(this, 'CustomDomainWWW', {
        value: `https://www.${domainName}`
      });
    }
  }
}

/**
 * Applies the full S3 public-access block after the bucket policy no longer
 * grants public reads. See the bucket comment for why this is not a property
 * on the bucket resource.
 */
function lockBucketAfterPolicy(scope: Construct, bucketName: string, bucketArn: string): cr.AwsCustomResource {
  const parameters = {
    Bucket: bucketName,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true
    }
  };
  const call = {
    service: 'S3',
    action: 'putPublicAccessBlock',
    parameters,
    physicalResourceId: cr.PhysicalResourceId.of('SiteBucketPublicAccessBlock')
  };
  return new cr.AwsCustomResource(scope, 'LockDownPublicAccess', {
    onCreate: call,
    onUpdate: call,
    installLatestAwsSdk: true,
    policy: cr.AwsCustomResourcePolicy.fromStatements([
      new iam.PolicyStatement({
        actions: ['s3:PutBucketPublicAccessBlock'],
        resources: [bucketArn]
      })
    ])
  });
}
