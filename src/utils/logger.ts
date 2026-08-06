export class Logger {
  public static info(message: string): void {
    console.log(`[*] ${message}`);
  }

  public static success(message: string): void {
    console.log(`[+] ${message}`);
  }

  public static warn(message: string): void {
    console.warn(`[!] WARNING: ${message}`);
  }

  public static error(message: string): void {
    console.error(`[-] ERROR: ${message}`);
  }
}
