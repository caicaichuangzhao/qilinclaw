/**
 * Generic Server-Sent Events (SSE) fetch utility to handle stream reading,
 * decoding, and chunk buffering.
 */

export interface FetchSSEOptions extends RequestInit {
    onChunk?: (data: any) => void;
    onError?: (error: any) => void;
    onDone?: () => void;
    onStatus?: (data: any) => void;
    onToolResult?: (data: any) => void;
    onSkillApproval?: (data: any) => void;
}

export async function fetchSSE(url: string, options: FetchSSEOptions): Promise<void> {
    const { onChunk, onError, onDone, onStatus, onToolResult, onSkillApproval, ...fetchOptions } = options;

    try {
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('Response body is not readable');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let hasError = false;

        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                if (buffer.trim()) {
                    const lines = buffer.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
                            try {
                                const data = JSON.parse(line.slice(6));
                                onChunk?.(data);
                            } catch (e) {
                                // Ignore incomplete trailing chunks
                            }
                        }
                    }
                }
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep the incomplete line in the buffer

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    if (line.trim() === 'data: [DONE]') continue;
                    try {
                        const data = JSON.parse(line.slice(6));

                        if (data.error) {
                            hasError = true;
                            onError?.(data.error);
                            break;
                        }

                        if (data.type === 'status') {
                            onStatus?.(data);
                        } else if (data.type === 'skill_approval_required') {
                            onSkillApproval?.(data);
                        } else if (data.type === 'tool_result') {
                            onToolResult?.(data);
                        } else {
                            // Includes 'chunk', delta updates, or native string chunks
                            onChunk?.(data);
                        }

                    } catch (e) {
                        console.warn('[fetchSSE] JSON parse error:', e, 'Line:', line);
                    }
                }
            }
            if (hasError) break;
        }

        if (!hasError) {
            onDone?.();
        }

    } catch (error) {
        // Re-throw AbortError so the caller's catch block can handle STOP gracefully
        // (preserving partial message content with '*(已暂停)*')
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'DOMException')) {
            throw error;
        }
        onError?.(error instanceof Error ? error.message : String(error));
    }
}
