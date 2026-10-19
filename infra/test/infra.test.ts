import { readFileSync } from 'fs';
import { join } from 'path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { GarageStack } from '../lib/garage-stack';
import { CertificateStack } from '../lib/certificate-stack';

const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

describe('CDK v2 infra', () => {
	test('does not depend on CDK v1 construct packages', () => {
		const names = Object.keys({
			...packageJson.dependencies,
			...packageJson.devDependencies
		});
		expect(names.filter((name) => name.startsWith('@aws-cdk/'))).toEqual([]);
		expect(packageJson.dependencies?.['aws-cdk-lib']).toBeTruthy();
	});

	test('synthesizes the static site stack', () => {
		const app = new cdk.App({
			context: {
				'hosted-zone:account=123456789012:domainName=gaslandsgarage.com:region=us-east-1': {
					Id: '/hostedzone/Z0123456789ABC',
					Name: 'gaslandsgarage.com.'
				}
			}
		});

		const stack = new GarageStack(app, 'InfraStack', {
			domainName: 'gaslandsgarage.com',
			certificateArn:
				'arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555',
			env: { account: '123456789012', region: 'us-east-1' }
		});

		const template = Template.fromStack(stack);
		template.resourceCountIs('AWS::S3::Bucket', 1);
		template.resourceCountIs('AWS::CloudFront::Distribution', 1);
		template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
		template.resourceCountIs('AWS::CloudFront::Function', 2);

		const buckets = template.findResources('AWS::S3::Bucket');
		for (const bucket of Object.values(buckets)) {
			expect(bucket.Properties.WebsiteConfiguration).toBeUndefined();
			expect(bucket.Properties.PublicAccessBlockConfiguration).toMatchObject({
				BlockPublicAcls: true,
				IgnorePublicAcls: true,
				BlockPublicPolicy: false,
				RestrictPublicBuckets: false
			});
		}

		const policies = JSON.stringify(template.findResources('AWS::S3::BucketPolicy'));
		expect(policies).not.toContain('"AWS":"*"');
		expect(policies).toContain('cloudfront.amazonaws.com');

		template.hasResourceProperties('AWS::CloudFront::Distribution', {
			DistributionConfig: {
				DefaultCacheBehavior: { Compress: true },
				CustomErrorResponses: [
					{ ErrorCode: 403, ResponseCode: 404, ResponsePagePath: '/404.html' },
					{ ErrorCode: 404, ResponseCode: 404, ResponsePagePath: '/404.html' }
				]
			}
		});

		const headers = JSON.stringify(template.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
		expect(headers).toContain("frame-ancestors 'none'");
		expect(headers).toContain('nominatim.openstreetmap.org');
		expect(headers).toContain('tile.openstreetmap.org');
		expect(headers).toContain('googletagmanager.com');
		expect(headers).toContain('maps.googleapis.com');
		// Firebase callable functions (buddies, account privacy, map placement).
		expect(headers).toContain('https://us-central1-gaslandsgarage-74ce6.cloudfunctions.net');
		expect(headers).toContain('DENY');
		expect(headers).toContain('strict-origin-when-cross-origin');
		expect(headers).toContain('ContentTypeOptions');
		expect(headers).toContain('Permissions-Policy');

		const viewerCode = JSON.stringify(template.findResources('AWS::CloudFront::Function'));
		expect(viewerCode).toContain('www.gaslandsgarage.com');
		expect(viewerCode).toContain('/builder');
		expect(viewerCode).toContain('/stats');
		expect(viewerCode).toContain('/admin/users');
		expect(viewerCode).toContain('/privacy');
		expect(viewerCode).toContain('/terms');
		expect(viewerCode).not.toContain('/beta');
		expect(viewerCode.toLowerCase()).not.toContain('g3e');

		const distribution = JSON.stringify(template.findResources('AWS::CloudFront::Distribution'));
		expect(distribution).toContain('us-central1-gaslandsgarage-74ce6.cloudfunctions.net');
		expect(distribution).toContain('/renderSharedCar');
		expect(distribution).toContain('/car/*');
		expect(distribution).toContain('/embed/*');
		const config = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0] as {
			Properties: {
				DistributionConfig: {
					DefaultCacheBehavior: { TargetOriginId: string };
					CacheBehaviors: Array<{ PathPattern?: string; TargetOriginId: string; ResponseHeadersPolicyId?: unknown }>;
				};
			};
		};
		const behaviors = config.Properties.DistributionConfig.CacheBehaviors;
		const car = behaviors.find((item) => item.PathPattern === '/car/*');
		const embed = behaviors.find((item) => item.PathPattern === '/embed/*');
		expect(car?.TargetOriginId).toBeTruthy();
		expect(car?.TargetOriginId).toBe(embed?.TargetOriginId);
		expect(car?.TargetOriginId).not.toBe(config.Properties.DistributionConfig.DefaultCacheBehavior.TargetOriginId);
		expect(car?.ResponseHeadersPolicyId).toBeUndefined();
		expect(embed?.ResponseHeadersPolicyId).toBeUndefined();
	});
});

describe('photo storage CSP', () => {
	test('allows Firebase Storage and the download redirect once a Content-Security-Policy is present', () => {
		const source = readFileSync(join(__dirname, '../lib/garage-stack.ts'), 'utf8');
		if (!source.includes('Content-Security-Policy')) return;
		expect(source).toContain('https://firebasestorage.googleapis.com');
		expect(source).toContain('https://storage.googleapis.com');
		expect(source).toContain('blob:');
		expect(source).toContain('data:');
	});
});

describe('staging stacks', () => {
	const context = {
		'hosted-zone:account=123456789012:domainName=gaslandsgarage.com:region=us-east-1': {
			Id: '/hostedzone/Z0123456789ABC',
			Name: 'gaslandsgarage.com.'
		}
	};
	const env = { account: '123456789012', region: 'us-east-1' };

	function stagingTemplate(): Template {
		const app = new cdk.App({ context });
		const stack = new GarageStack(app, 'StagingInfraStack', {
			domainName: 'staging.gaslandsgarage.com',
			zoneName: 'gaslandsgarage.com',
			includeWww: false,
			noindex: true,
			firebaseProjectId: 'gaslandsgarage-staging',
			certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/staging',
			env
		});
		return Template.fromStack(stack);
	}

	test('serves only staging.gaslandsgarage.com with its own bucket', () => {
		const template = stagingTemplate();
		template.resourceCountIs('AWS::S3::Bucket', 1);
		template.hasResourceProperties('AWS::CloudFront::Distribution', {
			DistributionConfig: { Aliases: ['staging.gaslandsgarage.com'] }
		});
		const records = Object.values(template.findResources('AWS::Route53::RecordSet'));
		expect(records.map((r) => r.Properties.Name)).toEqual(['staging.gaslandsgarage.com.']);
	});

	test('sends noindex and points CSP at the staging Firebase project only', () => {
		const policies = Object.values(stagingTemplate().findResources('AWS::CloudFront::ResponseHeadersPolicy'));
		expect(policies).toHaveLength(3);
		for (const policy of policies) {
			const config = policy.Properties.ResponseHeadersPolicyConfig;
			expect(config.CustomHeadersConfig.Items).toContainEqual({
				Header: 'X-Robots-Tag',
				Value: 'noindex, nofollow',
				Override: true
			});
			const csp = config.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy as string;
			expect(csp).toContain('https://us-central1-gaslandsgarage-staging.cloudfunctions.net');
			expect(csp).not.toContain('gaslandsgarage-74ce6');
		}
	});

	test('certificate covers only the staging host and uses its own export', () => {
		const app = new cdk.App({ context });
		const stack = new CertificateStack(app, 'StagingCertificateStack', {
			domainName: 'staging.gaslandsgarage.com',
			zoneName: 'gaslandsgarage.com',
			includeWww: false,
			exportName: 'StagingSiteCertificateArn',
			env
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::CertificateManager::Certificate', {
			DomainName: 'staging.gaslandsgarage.com'
		});
		const cert = Object.values(template.findResources('AWS::CertificateManager::Certificate'))[0];
		expect(cert.Properties.SubjectAlternativeNames).toBeUndefined();
		template.hasOutput('CertificateArn', { Export: { Name: 'StagingSiteCertificateArn' } });
	});

	test('production stack sends no noindex header', () => {
		const app = new cdk.App({ context });
		const stack = new GarageStack(app, 'InfraStack', {
			domainName: 'gaslandsgarage.com',
			certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/prod',
			env
		});
		expect(JSON.stringify(Template.fromStack(stack).toJSON())).not.toContain('X-Robots-Tag');
	});
});
