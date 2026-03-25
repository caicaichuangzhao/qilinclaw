import { knowledgeService } from '../src/services/knowledge-service.js';

async function rebuildAllEmbeddings() {
    console.log('开始重建所有知识库的 Embeddings...');
    const kbs = knowledgeService.getAllKnowledgeBases();

    if (kbs.length === 0) {
        console.log('没有找到任何知识库，跳过重建。');
        return;
    }

    console.log(`找到 ${kbs.length} 个知识库，准备开始处理...`);

    let totalSuccess = 0;
    let totalFailed = 0;

    for (const kb of kbs) {
        console.log(`\n正在处理知识库: ${kb.name} (${kb.id})`);
        const result = await knowledgeService.regenerateKnowledgeBaseEmbeddings(kb.id);
        console.log(`知识库 ${kb.name} 处理完成: 成功 ${result.success} 个，失败 ${result.failed} 个`);

        if (result.errors && result.errors.length > 0) {
            console.error('错误详情:');
            result.errors.forEach(err => console.error(`  - ${err}`));
        }

        totalSuccess += result.success;
        totalFailed += result.failed;
    }

    console.log('\n--- 所有知识库处理完毕 ---');
    console.log(`总计成功: ${totalSuccess} 个文档`);
    console.log(`总计失败: ${totalFailed} 个文档`);

    process.exit(totalFailed > 0 ? 1 : 0);
}

rebuildAllEmbeddings().catch(err => {
    console.error('脚本执行发生未捕获异常:', err);
    process.exit(1);
});
