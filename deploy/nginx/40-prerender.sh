#!/bin/sh
# THE SIDECAR IS OPT-IN, AND ITS ABSENCE MUST COST NOTHING.
#
# The templates are filled by 20-envsubst-on-templates.sh whatever the environment holds, so with no
# PRERENDER_URL the include would name an upstream that is not there and every crawler request
# would be a 502. This runs after envsubst and before nginx starts, and replaces the include with
# STUBS OF THE SAME NAMES — not an empty file, because the server block refers to @prerender and a
# named location that does not exist is nginx refusing to boot rather than a graceful fallback.
#
# Where the sidecar IS on, it fills the resolver. A proxy_pass whose url carries a runtime variable
# ($scheme, $host) is resolved per request, so nginx needs one; without it every crawler got "no
# resolver defined" and a 502. It is done here rather than by envsubst because the base image's
# NGINX_LOCAL_RESOLVERS does not reliably reach the template, and /etc/resolv.conf always does.
set -e
INC=/etc/nginx/conf.d/prerender.inc
if [ -z "${PRERENDER_URL}" ]; then
  cat > "$INC" <<'STUB'
# no sidecar: the same names, doing what the site did before one existed
location @prerender { try_files /index.html =404; }
location @app       { try_files /index.html =404; }
location @shot      { return 404; }
location @nopicture { return 404; }
location ^~ /share/ { try_files $uri =404; expires 1y; add_header Cache-Control "public, immutable"; }
STUB
  echo "prerender: PRERENDER_URL unset — serving the build's own pages and pictures"
else
  RES="${PRERENDER_RESOLVER:-$(awk '/^nameserver/ { printf "%s ", $2 }' /etc/resolv.conf)}"
  [ -n "$RES" ] || RES="127.0.0.11"
  sed -i "s|__RESOLVER__|${RES}|" "$INC"
  echo "prerender: crawlers and missing share pictures go to ${PRERENDER_URL} (resolver ${RES})"
fi
