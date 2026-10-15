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
  OriginRequestPolicy,
  SecurityPolicyProtocol,
  SSLMethod
} from 'aws-cdk-lib/aws-cloudfront';
import { S3StaticWebsiteOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';

export interface GarageStackProps extends cdk.StackProps {
  domainName?: string;
  certificateArn?: string;
}

export class GarageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: GarageStackProps) {
    super(scope, id, props);
    
    // Define domain name
    const domainName = props?.domainName || 'gaslandsgarage.com';

    /* ----------------------------------------------------------------
       S3 bucket for the static site
       ---------------------------------------------------------------- */
    const siteBucket = new Bucket(this, 'SiteBucket', {
      websiteIndexDocument: 'index.html',
      encryption: BucketEncryption.S3_MANAGED,

      // ----  Allow public reads (static-site style)  ----
      blockPublicAccess: new BlockPublicAccess({
        blockPublicAcls: false,
        ignorePublicAcls: false,
        blockPublicPolicy: false,
        restrictPublicBuckets: false
      }),

      removalPolicy: RemovalPolicy.DESTROY,   // dev-friendly cleanup
      autoDeleteObjects: true
    });

    // Bucket policy: allow anyone to GET objects
    siteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:GetObject'],
        resources: [siteBucket.arnForObjects('*')]
      })
    );

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
      defaultBehavior: {
        origin: new S3StaticWebsiteOrigin(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      domainNames: [domainName, `www.${domainName}`],
      certificate: siteCertificate,
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(1)
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(1)
        }
      ],
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021
    });
    
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
    
    // Create CNAME record for www subdomain
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

