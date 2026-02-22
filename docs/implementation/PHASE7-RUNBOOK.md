# Phase 7 Operations Runbook

## Service Packaging
- Linux: use generated systemd unit from shared ops service-packaging module.
- macOS: use generated launchd plist from shared ops service-packaging module.

## Installer Flow
- Collect required config: business name, host, port, database URL, timezone.
- Generate `.env` using installer helper and validate before first start.

## Backup and Restore
- Encrypt backup blobs with backup secret before persistence.
- Restore path: decrypt blob, validate JSON payload, then replay to persistence layer.

## Diagnostics
- Generate diagnostics snapshots including dependency checks and runtime metrics.
- Mark degraded if any dependency check is down.

## Monitoring and Alerts
- Webhook latency P95 > 2s for 5m => critical alert.
- Message send latency P95 > 5s for 10m => warning alert.
- Error rate > 5% for 5m => critical alert.

## Incident References
- provider-outage: enable fallback queue and inspect circuit state.
- webhook-signature-failures: validate secret rotation and signatures.
- high-no-show-spike: inspect reminder and classification metrics.
