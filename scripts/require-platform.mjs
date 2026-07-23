const [expectedPlatform, expectedArch] = process.argv.slice(2)

if (!expectedPlatform || !expectedArch) {
  console.error('Usage: node scripts/require-platform.mjs <platform> <arch>')
  process.exit(2)
}

if (process.platform !== expectedPlatform || process.arch !== expectedArch) {
  console.error(
    `Packaging must run natively on ${expectedPlatform}/${expectedArch}; ` +
      `current host is ${process.platform}/${process.arch}. ` +
      'This guard prevents shipping an incompatible native SQLite module.',
  )
  process.exit(1)
}
