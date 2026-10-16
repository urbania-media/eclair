/** One event of a `text/event-stream`. */
export interface ServerSentEvent {
    event: string;
    data: string;
}

/** Reads the events of a `text/event-stream` body. Comments (`: ping`) are skipped. */
export async function* readEvents(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let end = buffer.indexOf('\n\n');
        while (end !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            let event = 'message';
            const data: string[] = [];
            for (const line of block.split('\n')) {
                if (line.startsWith('event:')) {
                    event = line.slice(6).trim();
                } else if (line.startsWith('data:')) {
                    data.push(line.slice(5).replace(/^ /, ''));
                }
            }
            if (data.length > 0) {
                yield { event, data: data.join('\n') };
            }
            end = buffer.indexOf('\n\n');
        }
    }
}
