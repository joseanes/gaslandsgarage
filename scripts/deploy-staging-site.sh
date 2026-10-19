#!/usr/bin/env bash
# Uploads app/build (built with `pnpm run build:staging`) to the staging stack.
# Staging must never be indexed: robots.txt disallows everything and the
# sitemap is not published. CloudFront also sends X-Robots-Tag: noindex.
set -euo pipefail
STACK=StagingInfraStack
BUILD=app/build

out() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

printf 'User-agent: *\nDisallow: /\n' > "$BUILD/robots.txt"
rm -f "$BUILD/sitemap.xml"

BUCKET=$(out BucketName)
[ -n "$BUCKET" ] && [ "$BUCKET" != "None" ] || { echo "No BucketName output on $STACK" >&2; exit 1; }
echo "Uploading to s3://$BUCKET"

aws s3 sync "$BUILD/" "s3://$BUCKET/" --delete \
  --exclude "_app/immutable/*" --exclude "_app/immutable/*/*" --exclude "_app/immutable/*/*/*"
aws s3 sync "$BUILD/_app/immutable/" "s3://$BUCKET/_app/immutable/" \
  --cache-control "public, max-age=31536000, immutable" --size-only
while IFS= read -r -d '' html; do
  aws s3 cp "$html" "s3://$BUCKET/${html#$BUILD/}" --cache-control "no-cache" --content-type "text/html; charset=utf-8"
done < <(find "$BUILD" -name '*.html' -print0)
node scripts/prune-immutable.mjs "$BUCKET" "$BUILD" 14
aws s3 cp "$BUILD/robots.txt" "s3://$BUCKET/robots.txt" --content-type text/plain --cache-control no-cache
aws s3 cp "$BUILD/favicon.ico" "s3://$BUCKET/favicon.ico" --content-type image/x-icon --cache-control max-age=86400
aws s3 cp "$BUILD/favicon.svg" "s3://$BUCKET/favicon.svg" --content-type image/svg+xml --cache-control max-age=86400
for icon in apple-touch-icon.png icon-192.png icon-512.png; do
  aws s3 cp "$BUILD/$icon" "s3://$BUCKET/$icon" --content-type image/png --cache-control max-age=86400
done
aws s3 cp "$BUILD/site.webmanifest" "s3://$BUCKET/site.webmanifest" --content-type application/manifest+json --cache-control max-age=86400

CF_DOMAIN=$(out CDNDistributionDomainName)
DIST_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='$CF_DOMAIN'].Id" --output text)
[ -n "$DIST_ID" ] || { echo "No distribution for $CF_DOMAIN" >&2; exit 1; }
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
echo "Staging site: $(out CustomDomain) (CloudFront $CF_DOMAIN)"
