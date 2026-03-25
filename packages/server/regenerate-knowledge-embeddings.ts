import { knowledgeService } from './src/services/knowledge-service.js';

async function regenerateEmbeddings() {
  await knowledgeService.initialize();
  
  console.log('=== 重新生成知识库嵌入 ===');
  const knowledgeBases = await knowledgeService.getAllKnowledgeBases();
  
  for (const kb of knowledgeBases) {
    console.log(`\n处理知识库: ${kb.name}`);
    
    const docs = await knowledgeService.getDocumentsForKnowledgeBase(kb.id);
    console.log(`找到 ${docs.length} 个文档`);
    
    for (const doc of docs) {
      console.log(`  重新生成文档: ${doc.originalName}`);
      const result = await knowledgeService.regenerateDocumentEmbeddings(doc.id);
      if (result.success) {
        console.log(`    ✅ 成功`);
      } else {
        console.log(`    ❌ 失败: ${result.error}`);
      }
    }
  }
  
  console.log('\n=== 完成 ===');
}

regenerateEmbeddings().catch(console.error);
