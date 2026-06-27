let cppCompiler = null;

async function initCppEnv() {
    terminal.println('C++ 环境已就绪', 'success-line');
    terminal.println('⚠ 浏览器端无内置编译器，无法在线运行', 'warning-line');
    terminal.println('建议：将代码复制到本地 GCC/Clang/VS 编译执行', 'info-line');
}

async function runCppCode(code) {
    terminal.println('==== C++ 代码 ====', 'info-line');
    terminal.println(code);
    terminal.println('\n❌ 浏览器不支持 C++ 编译运行', 'error-line');
    terminal.println('请使用本地编译器运行代码', 'info-line');
}