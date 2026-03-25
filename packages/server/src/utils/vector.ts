export function cosineSimilarity(a: number[], b: number[]): number {
  // Use the shorter vector length to handle dimension mismatches gracefully
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Dynamically read the configured embedding dimension at runtime
// This is lazily loaded to avoid circular dependency with embeddingService
let _configuredDimension: number | null = null;

export function setEmbeddingDimension(dim: number): void {
  _configuredDimension = dim;
}

export function getEmbeddingDimension(): number {
  return _configuredDimension || 1024;
}

export function serializeEmbedding(embedding: number[], targetDimension?: number): Float32Array {
  const dim = targetDimension ?? getEmbeddingDimension();
  const buffer = new ArrayBuffer(dim * 4);
  const view = new Float32Array(buffer);

  const len = Math.min(embedding.length, dim);
  for (let i = 0; i < len; i++) {
    view[i] = embedding[i];
  }

  if (embedding.length > dim) {
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      norm += view[i] * view[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        view[i] /= norm;
      }
    }
  }
  return view;
}

export function deserializeEmbedding(data: Uint8Array | Buffer | Float32Array | null): number[] {
  if (!data) return [];
  if (data instanceof Float32Array) {
    return Array.from(data);
  }
  const buffer = data instanceof Buffer ? data : Buffer.from(data);
  const view = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  return Array.from(view);
}
