#!/bin/bash
# 在 ECS 上执行一条 shell 命令并打印输出，不需要 SSH。
#
# 走阿里云 Cloud Assistant（RunCommand + DescribeInvocationResults）：命令以 base64
# 提交，结果同样以 base64 返回。用这种方式是因为部署这台机器时手上只有 AccessKey，
# 没有 SSH 口令——而且它顺带绕开了安全组（Cloud Assistant 是实例内的 agent 主动
# 回连，不需要任何入方向端口）。
#
# 用法：  bash run-on-ecs.sh 'free -m'
# 依赖：  deploy/aliyun/.env.aliyun（含 AccessKey 与 ECS_INSTANCE_ID 或 ECS_HOST）
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . deploy/aliyun/.env.aliyun; set +a
export ALIBABA_CLOUD_ACCESS_KEY_ID="${ALIYUN_ACCESS_KEY_ID}"
export ALIBABA_CLOUD_ACCESS_KEY_SECRET="${ALIYUN_ACCESS_KEY_SECRET}"
REGION="${ALIYUN_REGION}"

INSTANCE="${ECS_INSTANCE_ID:-}"
if [ -z "$INSTANCE" ]; then
  INSTANCE=$(aliyun ecs DescribeInstances --RegionId "$REGION" --PageSize 100 2>/dev/null \
    | python3 -c "
import sys, json
want = '${ECS_HOST}'
for i in json.load(sys.stdin)['Instances']['Instance']:
    ips = (i.get('PublicIpAddress') or {}).get('IpAddress') or []
    if want in ips:
        print(i['InstanceId']); break
")
fi
[ -z "$INSTANCE" ] && { echo "找不到实例（ECS_HOST=${ECS_HOST}）" >&2; exit 1; }

CMD="${1:?用法: run-on-ecs.sh '<shell 命令>'}"
B64=$(printf '%s' "$CMD" | base64)

INVOKE=$(aliyun ecs RunCommand --RegionId "$REGION" --InstanceId.1 "$INSTANCE" \
  --Type RunShellScript --ContentEncoding Base64 --CommandContent "$B64" --Timeout 120 \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["InvokeId"])')

for _ in $(seq 1 40); do
  sleep 2
  OUT=$(aliyun ecs DescribeInvocationResults --RegionId "$REGION" --InvokeId "$INVOKE" 2>/dev/null || echo '{}')
  PARSED=$(printf '%s' "$OUT" | python3 -c '
import sys, json, base64
try:
    r = json.load(sys.stdin)["Invocation"]["InvocationResults"]["InvocationResult"][0]
except Exception:
    print("PENDING"); raise SystemExit
status = r["InvocationStatus"]
if status in ("Success", "Failed"):
    print(status)
    sys.stdout.write(base64.b64decode(r.get("Output") or "").decode("utf8", "replace"))
else:
    print("PENDING")
')
  STATUS=$(printf '%s' "$PARSED" | head -1)
  if [ "$STATUS" = "Success" ] || [ "$STATUS" = "Failed" ]; then
    printf '%s' "$PARSED" | tail -n +2
    [ "$STATUS" = "Failed" ] && exit 1
    exit 0
  fi
done
echo "超时：命令未在 80 秒内返回" >&2
exit 1
