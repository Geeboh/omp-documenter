export function runCommand(argv, services) {
  const [command, ...flags] = argv;
  const dryRun = flags.includes('--dry-run');

  switch (command) {
    case 'sync':
      return services.sync({ dryRun });
    case 'migrate':
      return services.migrate({ dryRun });
    case 'doctor':
      return services.doctor({ verbose: flags.includes('--verbose') });
    default:
      throw new Error(`unknown CLI command: ${command}`);
  }
}
