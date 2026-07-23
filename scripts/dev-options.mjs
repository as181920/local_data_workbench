const DEFAULT_PORT = 5173;

export function parseDevOptions(args) {
  let port = DEFAULT_PORT;
  const forwardedArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--port" || argument === "-p") {
      const value = args[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a port number.`);
      port = parsePort(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--port=") || argument.startsWith("-p=")) {
      port = parsePort(argument.slice(argument.indexOf("=") + 1));
      continue;
    }
    forwardedArgs.push(argument);
  }

  const host = "127.0.0.1";
  return {
    port,
    devServerUrl: `http://${host}:${port}`,
    viteArgs: [...forwardedArgs, "--host", host, "--port", String(port), "--strictPort"]
  };
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid development server port: ${value}`);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Development server port must be between 1 and 65535: ${value}`);
  }
  return port;
}
