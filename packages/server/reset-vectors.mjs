import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'path';

const dbPath = path.resolve(process.cwd(), '.dragon-claw/dragon-claw.db');
console.log('Opening DB at:', dbPath);
const db = new Database(dbPath);

sqliteVec.load(db);

console.log('Dropping old vector virtual tables...');
db.exec('DROP TABLE IF EXISTS vec_agent_memory');
db.exec('DROP TABLE IF EXISTS vec_document_chunks');
db.exec('DROP TABLE IF EXISTS vec_conversation_summaries');

console.log('Clearing old embeddings...');
db.exec("UPDATE agent_memory_files SET embedding = NULL, embedding_status = 'pending'");
db.exec("UPDATE document_chunks SET embedding = NULL");
db.exec("UPDATE knowledge_documents SET embedding_status = 'pending'");
db.exec("UPDATE conversation_summaries SET embedding = NULL");
db.exec("UPDATE vector_entries SET embedding = NULL");

console.log('Database vector tables dropped and embeddings cleared successfully.');
db.close();
