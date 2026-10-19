// infra/lib/certificate-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';

export interface CertificateStackProps extends cdk.StackProps {
  domainName: string;
  /** Hosted zone that validates the certificate. Defaults to domainName. */
  zoneName?: string;
  /** Add www.<domainName> as a SAN. Defaults to true (production). */
  includeWww?: boolean;
  /** CloudFormation export for the ARN. Defaults to SiteCertificateArn. */
  exportName?: string;
}

export class CertificateStack extends cdk.Stack {
  public readonly certificate: Certificate;
  
  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, {
      ...props,
      env: {
        account: props.env?.account,
        region: 'us-east-1' // ACM certificates for CloudFront must be in us-east-1
      }
    });
    
    const domainName = props.domainName;
    
    // Look up the hosted zone for the domain
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.zoneName ?? domainName
    });
    
    // Create a certificate in us-east-1 (required for CloudFront)
    this.certificate = new Certificate(this, 'SiteCertificate', {
      domainName,
      subjectAlternativeNames: props.includeWww === false ? undefined : [`www.${domainName}`],
      validation: CertificateValidation.fromDns(hostedZone)
    });
    
    // Output the certificate ARN
    new cdk.CfnOutput(this, 'CertificateArn', {
      value: this.certificate.certificateArn,
      exportName: props.exportName ?? 'SiteCertificateArn'
    });
  }
}