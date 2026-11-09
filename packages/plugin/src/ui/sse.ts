/** Инкрементальный парсер text/event-stream: куски приходят произвольно. */
export interface SseMessage {
  event: string;
  data: string;
}

export class SseParser {
  private buf = '';

  push(chunk: string): SseMessage[] {
    this.buf += chunk.replace(/\r\n/g, '\n');
    const out: SseMessage[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length > 0) out.push({ event, data: data.join('\n') });
    }
    return out;
  }
}
