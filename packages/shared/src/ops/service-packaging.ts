export function renderSystemdService(serviceName: string, startCommand: string): string {
  return [
    '[Unit]',
    `Description=${serviceName}`,
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    'Restart=always',
    'RestartSec=5',
    `ExecStart=${startCommand}`,
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ].join('\n');
}

export function renderLaunchdPlist(label: string, startCommand: string): string {
  return [
    '<?xml version=\'1.0\' encoding=\'UTF-8\'?>',
    '<!DOCTYPE plist PUBLIC \'-//Apple//DTD PLIST 1.0//EN\' \'http://www.apple.com/DTDs/PropertyList-1.0.dtd\'>',
    '<plist version=\'1.0\'>',
    '<dict>',
    '<key>Label</key>',
    `<string>${label}</string>`,
    '<key>ProgramArguments</key>',
    '<array>',
    `<string>${startCommand}</string>`,
    '</array>',
    '<key>RunAtLoad</key>',
    '<true/>',
    '<key>KeepAlive</key>',
    '<true/>',
    '</dict>',
    '</plist>',
  ].join('\n');
}