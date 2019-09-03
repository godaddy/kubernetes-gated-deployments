#!/bin/sh

set -e

SHA=$(git rev-parse --short HEAD)
TAG=$(git describe)

docker build -t godaddy/kubernetes-gated-deployments:$SHA .
docker tag godaddy/kubernetes-gated-deployments:$SHA godaddy/kubernetes-gated-deployments:$TAG

perl -i -pe "s/tag: [a-zA-Z0-9\.]*/tag: $TAG/" helm/kubernetes-gated-deployments/values.yaml
perl -i -pe "s/appVersion: [a-zA-Z0-9\.]*/appVersion: $TAG/" helm/kubernetes-gated-deployments/Chart.yaml
git commit helm/kubernetes-gated-deployments/values.yaml helm/kubernetes-gated-deployments/Chart.yml -m "chore(release): godaddy/kubernetes-gated-deployments:$TAG"

echo ""
echo "Run the following to publish:"
echo ""
echo "  git push --follow-tags origin master && docker push godaddy/kubernetes-gated-deployments:$TAG"
echo ""
