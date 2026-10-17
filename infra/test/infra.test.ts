import { readFileSync } from 'fs';
import { join } from 'path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { GarageStack } from '../lib/garage-stack';

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
		template.resourceCountIs('AWS::CloudFront::Function', 1);

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

		const viewerCode = JSON.stringify(template.findResources('AWS::CloudFront::Function'));
		expect(viewerCode).toContain('www.gaslandsgarage.com');
		expect(viewerCode).toContain('/builder');
		expect(viewerCode).not.toContain('/beta');
	});
});
