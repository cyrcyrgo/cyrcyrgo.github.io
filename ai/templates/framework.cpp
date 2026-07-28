#include <iostream>
#include <string>
#include <vector>
#include <map>
#include <cmath>
#include <algorithm>
#include <sstream>

// ============================================================
//  KOBG AI - 强化式训练框架 (C++ Native Implementation)
//  本框架由项目内置，AI 负责填充训练数据和对话内容
// ============================================================

class KOBGModel {
private:
    // 知识库：存储问答对
    std::map<std::string, std::string> knowledge_base;
    // 训练数据记录
    std::vector<std::pair<std::string, std::string>> training_history;
    // 模型名称
    std::string model_name;
    // 训练轮次
    int training_epochs;
    // 学习率
    double learning_rate;

public:
    KOBGModel(const std::string& name = "KOBG-AI-Model")
        : model_name(name), training_epochs(0), learning_rate(0.01) {
        initializeKnowledgeBase();
    }

    // [AI-GENERATED]: 初始化知识库内容
    void initializeKnowledgeBase() {
        // === AI 训练数据填充区 ===
        // 请在此处填充问答对，格式如下：
        // knowledge_base["问题"] = "答案";
        
        // @@AI_CONTENT_BEGIN@@
        knowledge_base["What is artificial intelligence?"] = 
            "Artificial Intelligence is the simulation of human intelligence by machines, "
            "encompassing learning, reasoning, and self-correction.";
        knowledge_base["What is machine learning?"] = 
            "Machine Learning is a subset of AI that enables systems to learn from data "
            "and improve performance without explicit programming.";
        knowledge_base["What is a neural network?"] = 
            "A neural network is a computational model inspired by biological neural networks, "
            "consisting of interconnected nodes (neurons) organized in layers.";
        knowledge_base["What is deep learning?"] = 
            "Deep Learning is a subset of machine learning using multi-layered neural networks "
            "to learn hierarchical representations of data.";
        knowledge_base["What is natural language processing?"] = 
            "NLP is a branch of AI that enables computers to understand, interpret, and "
            "generate human language.";
        // @@AI_CONTENT_END@@
    }

    // 训练：添加新的问答对
    void train(const std::string& input, const std::string& output) {
        training_history.push_back({input, output});
        knowledge_base[input] = output;
        training_epochs++;
    }

    // 预测：根据输入返回答案
    std::string predict(const std::string& input) {
        // 精确匹配
        auto it = knowledge_base.find(input);
        if (it != knowledge_base.end()) {
            return it->second;
        }

        // 模糊匹配：查找包含关键词的条目
        std::string best_match = "";
        double best_score = 0.0;
        
        for (const auto& pair : knowledge_base) {
            double score = calculateSimilarity(input, pair.first);
            if (score > best_score) {
                best_score = score;
                best_match = pair.second;
            }
        }

        if (best_score > 0.3) {
            return "[模糊匹配 置信度: " + std::to_string(best_score).substr(0, 4) + "] " + best_match;
        }

        return "我还没有学习到这个问题的答案，请继续训练我。";
    }

    // 计算两个字符串的相似度（简单版本）
    double calculateSimilarity(const std::string& s1, const std::string& s2) {
        std::string lower1 = s1, lower2 = s2;
        std::transform(lower1.begin(), lower1.end(), lower1.begin(), ::tolower);
        std::transform(lower2.begin(), lower2.end(), lower2.begin(), ::tolower);

        int match_count = 0;
        std::istringstream iss1(lower1), iss2(lower2);
        std::vector<std::string> words1, words2;
        std::string word;
        
        while (iss1 >> word) words1.push_back(word);
        while (iss2 >> word) words2.push_back(word);

        for (const auto& w1 : words1) {
            for (const auto& w2 : words2) {
                if (w1 == w2) match_count++;
            }
        }

        int total = std::max(words1.size(), words2.size());
        return total > 0 ? static_cast<double>(match_count) / total : 0.0;
    }

    // 显示知识库
    void showKnowledgeBase() {
        std::cout << "========================================" << std::endl;
        std::cout << "  KOBG AI 模型: " << model_name << std::endl;
        std::cout << "  训练轮次: " << training_epochs << std::endl;
        std::cout << "  知识库条目: " << knowledge_base.size() << std::endl;
        std::cout << "========================================" << std::endl;
        
        int index = 1;
        for (const auto& pair : knowledge_base) {
            std::cout << "[" << index << "] Q: " << pair.first << std::endl;
            std::cout << "    A: " << pair.second.substr(0, 80);
            if (pair.second.length() > 80) std::cout << "...";
            std::cout << std::endl;
            index++;
        }
        std::cout << "========================================" << std::endl;
    }

    // 获取训练轮次
    int getTrainingEpochs() const { return training_epochs; }

    // 获取知识库大小
    int getKnowledgeSize() const { return knowledge_base.size(); }
};

// ============================================================
//  AI 对话系统模拟
// ============================================================

class AIDialogueSystem {
private:
    KOBGModel model;
    std::vector<std::string> conversation_log;

public:
    AIDialogueSystem() : model("KOBG-Trained-AI") {}

    void runDialogue() {
        std::cout << "========================================" << std::endl;
        std::cout << "   KOBG AI 对话系统启动" << std::endl;
        std::cout << "========================================" << std::endl;
        std::cout << std::endl;

        // @@AI_DIALOGUE_BEGIN@@
        // 在此处填充对话测试用例
        std::vector<std::string> test_questions = {
            "What is artificial intelligence?",
            "What is machine learning?",
            "What is a neural network?",
            "What is deep learning?",
            "What is natural language processing?",
            "Tell me about reinforcement learning"
        };
        // @@AI_DIALOGUE_END@@

        for (const auto& question : test_questions) {
            std::cout << "用户: " << question << std::endl;
            std::string answer = model.predict(question);
            std::cout << "AI: " << answer << std::endl;
            std::cout << "----------------------------------------" << std::endl;
            conversation_log.push_back("Q: " + question + " | A: " + answer);
        }
    }

    void showStatistics() {
        std::cout << std::endl;
        std::cout << "========================================" << std::endl;
        std::cout << "   训练统计" << std::endl;
        std::cout << "========================================" << std::endl;
        std::cout << "  总对话轮次: " << conversation_log.size() << std::endl;
        std::cout << "  训练轮次: " << model.getTrainingEpochs() << std::endl;
        std::cout << "  知识库大小: " << model.getKnowledgeSize() << std::endl;
        std::cout << "========================================" << std::endl;
    }
};

// ============================================================
//  主函数
// ============================================================

int main() {
    std::cout << std::endl;
    std::cout << "  ╔══════════════════════════════════════╗" << std::endl;
    std::cout << "  ║     KOBG AI 强化式训练系统 v1.0      ║" << std::endl;
    std::cout << "  ║   C++ Native AI Training Framework   ║" << std::endl;
    std::cout << "  ╚══════════════════════════════════════╝" << std::endl;
    std::cout << std::endl;

    AIDialogueSystem dialogue_system;
    
    // 先展示知识库
    // dialogue_system.model.showKnowledgeBase(); // 注意：model 是私有的
    // 改为通过对话系统展示
    
    // 运行对话
    dialogue_system.runDialogue();
    
    // 展示统计
    dialogue_system.showStatistics();

    std::cout << std::endl;
    std::cout << "  [KOBG AI] 训练完成！" << std::endl;
    std::cout << std::endl;

    return 0;
}