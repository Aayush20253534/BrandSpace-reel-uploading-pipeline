type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

export function createLogger(service: string) {
  const write = (level: Level, event: string, fields: Fields = {}) => {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      ...fields,
    };
    const output = JSON.stringify(record);
    if (level === "error") console.error(output);
    else if (level === "warn") console.warn(output);
    else console.log(output);
  };

  return {
    debug: (event: string, fields?: Fields) => write("debug", event, fields),
    info: (event: string, fields?: Fields) => write("info", event, fields),
    warn: (event: string, fields?: Fields) => write("warn", event, fields),
    error: (event: string, fields?: Fields) => write("error", event, fields),
  };
}
