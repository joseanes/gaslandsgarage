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

export interface GarageStackProps extends cdk.StackProps {
  domainName?: string;
  certificateArn?: string;
}

/**
 * Viewer-request function.
 * - www.gaslandsgarage.com → 301 to the apex, same path and query.
 * - `/` and `/index.html` → 301 to `/builder` (keeps ?draft= and ?open=).
 * - `/builder` and `/stats` are client routes, not S3 objects. Rewrite them to
 *   `/index.html` so the SPA still loads. Query strings stay on the browser URL.
 * - Every other path is left alone. Missing objects 403 from the private bucket,
 *   and CloudFront turns that into a real 404.
 * Add a new app route here when one is created, or it will 404.
 */
const VIEWER_REQUEST_CODE = `
function handler(event) {
  var request = event.request;
  var hostHeader = request.headers && request.headers.host;
  var host = hostHeader && hostHeader.value ? hostHeader.value.toLowerCase() : '';
  var uri = request.uri || '/';
  var query = toQuery(request.querystring);
  var dest = normalize(uri);
  if (host === 'www.gaslandsgarage.com' || dest !== uri) {
    return redirect('https://gaslandsgarage.com' + dest + query);
  }
  if (uri === '/builder' || uri === '/stats') {
    request.uri = '/index.html';
  }
  return request;
}

function normalize(uri) {
  if (uri === '/' || uri === '/index.html') return '/builder';
  if (uri === '/builder/' || uri === '/stats/') return uri.slice(0, -1);
  return uri;
}

function redirect(location) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: location }
    }
  };
}

function toQuery(querystring) {
  if (!querystring) return '';
  var parts = [];
  var key;
  for (key in querystring) {
    if (!Object.prototype.hasOwnProperty.call(querystring, key)) continue;
    var entry = querystring[key] || {};
    if (entry.multiValue && entry.multiValue.length) {
      var i;
      for (i = 0; i < entry.multiValue.length; i++) {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(entry.multiValue[i].value));
      }
    } else if (entry.value) {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(entry.value));
    } else {
      parts.push(encodeURIComponent(key));
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}
`;

export class GarageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: GarageStackProps) {
    super(scope, id, props);
    
    // Define domain name
    const domainName = props?.domainName || 'gaslandsgarage.com';

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

    const htmlHeaders = new ResponseHeadersPolicy(this, 'HtmlHeaders', {
      comment: 'HTML and app routes must revalidate. Hashed files are a separate behavior.',
      securityHeadersBehavior: { strictTransportSecurity: hsts },
      customHeadersBehavior: {
        customHeaders: [{ header: 'Cache-Control', value: 'no-cache', override: true }]
      }
    });

    const immutableHeaders = new ResponseHeadersPolicy(this, 'ImmutableHeaders', {
      comment: 'SvelteKit content hashes change when the file changes.',
      securityHeadersBehavior: { strictTransportSecurity: hsts },
      customHeadersBehavior: {
        customHeaders: [{
          header: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
          override: true
        }]
      }
    });

    const staticHeaders = new ResponseHeadersPolicy(this, 'StaticHeaders', {
      comment: 'Icons, images, robots.txt, and the sitemap.',
      securityHeadersBehavior: { strictTransportSecurity: hsts },
      customHeadersBehavior: {
        customHeaders: [{ header: 'Cache-Control', value: 'public, max-age=86400', override: true }]
      }
    });

    const viewerRequest = new Function(this, 'ViewerRequest', {
      comment: 'Redirect www and / to the apex builder, and keep SPA routes on index.html.',
      code: FunctionCode.fromInline(VIEWER_REQUEST_CODE),
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
      domainName: domainName,
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
          subjectAlternativeNames: [`www.${domainName}`], // Include www subdomain
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
      domainNames: [domainName, `www.${domainName}`],
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
    new route53.CnameRecord(this, 'WWWRecord', {
      recordName: `www.${domainName}`,
      domainName: domainName,
      zone: hostedZone
    });

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
    
    new cdk.CfnOutput(this, 'CustomDomainWWW', {
      value: `https://www.${domainName}`
    });
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
