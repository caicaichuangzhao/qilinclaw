const Database = require('better-sqlite3');
const dbPath = require('path').resolve(process.env.WORKSPACE_ROOT || require('path').join(process.cwd(), '../..'), '.qilin-claw', 'knowledge.db');

try {
  console.log('Opening DB:', dbPath);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  
  const docs = db.prepare('SELECT id, original_name, embedding_status FROM knowledge_documents').all();
  console.log('Docs found:', docs.length);
  console.log(docs);
  
  const chunks = db.prepare('SELECT document_id, count(*) as count FROM document_chunks GROUP BY document_id').all();
  console.log('Chunks:', chunks);
  
  const embSample = db.prepare('SELECT length(embedding) as byte_len, typeof(embedding) as type FROM document_chunks LIMIT 1').get();
  console.log('Sample Emb:', embSample);
  
  db.close();
} catch (e) {
  console.error('Error:', e.message);
}
