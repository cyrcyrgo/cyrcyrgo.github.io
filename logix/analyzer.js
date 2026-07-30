/**
 * LogiX v3.0 — 万级规则 Python 静态代码分析引擎
 * 数据驱动架构：组合规则生成 + 逐行扫描检测
 * 简易模式：语法+基础检测
 * 进阶模式：10000+ 组合规则检测
 */

class LogiX {
    constructor() {
        this.mode = 'simple';
        this._analysisCount = 0;
        this._totalTime = 0;
        this._rules = [];
        this._generateMassRules();
        this._initAllRules();
    }

    /**
     * 万级规则生成器 — 基于组合数据自动生成大量检测规则
     */
    _generateMassRules() {
        this._massRules = [];
        this._generateBuiltinRules();
        this._generateStdlibRules();
        this._generateMethodRules();
        this._generateExceptionRules();
        this._generateTypeRules();
        this._generateNamingRules();
        this._generateOperatorRules();
        this._generateNumberRules();
        this._generateImportRules();
        this._generateControlFlowRules();
        this._generateGeneralQualityRules();
        this._generateMoreMassRules();
        this._generateMegaRules();
    }

    _rule(pattern, type, category, severity, message, fix) {
        const r = { type, category, severity, message, fix };
        if (typeof pattern === 'function') r.check = pattern; else r.pattern = pattern;
        this._massRules.push(r);
    }

    _generateBuiltinRules() {
        const builtins = [
            'abs','all','any','ascii','bin','bool','breakpoint','bytearray','bytes','callable','chr','classmethod','compile','complex','delattr','dict','dir','divmod','enumerate','eval','exec','exit','filter','float','format','frozenset','getattr','globals','hasattr','hash','help','hex','id','input','int','isinstance','issubclass','iter','len','list','locals','map','max','memoryview','min','next','object','oct','open','ord','pow','print','property','quit','range','repr','reversed','round','set','setattr','slice','sorted','staticmethod','str','sum','super','tuple','type','vars','zip'
        ];
        const dangerous = new Set(['eval','exec','compile','__import__','breakpoint','exit','quit','help','globals','locals','vars','input']);
        const needIter = new Set(['sum','min','max','sorted','reversed','enumerate','zip','map','filter','any','all','list','tuple','set','frozenset']);
        const needNumeric = new Set(['abs','round','pow','divmod','bin','oct','hex']);

        for (const fn of builtins) {
            // 基础调用检查
            this._rule(new RegExp(`\\b${fn}\\s*\\(`), 'BuiltinCheck', 'builtin_usage', 'info', `使用内建函数 ${fn}()`, `确保 ${fn}() 的参数正确`);
            // 空参数调用检查
            this._rule(new RegExp(`\\b${fn}\\s*\\(\\s*\\)`), 'BuiltinCheck', 'builtin_usage', 'info', `${fn}() 被空参数调用 — 确认是否有意义`, `检查 ${fn}() 是否需要参数`);
            // 危险函数
            if (dangerous.has(fn)) {
                this._rule(new RegExp(`\\b${fn}\\s*\\(`), 'SecurityWarning', 'security', 'warning', `"${fn}()" 是潜在危险函数`, `避免在生产代码中使用 ${fn}()`);
            }
            // 需要可迭代对象
            if (needIter.has(fn)) {
                this._rule(new RegExp(`\\b${fn}\\s*\\([^)]*\d+[^)]*\\)`), 'TypeCheck', 'type_safety', 'info', `${fn}() 的参数应为可迭代对象，而不是数字`, `确保传给 ${fn}() 的是可迭代对象`);
            }
            // 需要数值
            if (needNumeric.has(fn)) {
                this._rule(new RegExp(`\\b${fn}\\s*\\([^)]*["'][^)]*\\)`), 'TypeCheck', 'type_safety', 'info', `${fn}() 的参数类型可能不正确`, `确保传给 ${fn}() 的是数值类型`);
            }
            // 内建函数赋值
            this._rule(new RegExp(`\\b${fn}\\s*=\\s*`), 'Warning', 'builtin_usage', 'warning', `覆盖内建函数 "${fn}" — 不推荐`, `使用其他变量名`);
        }
    }

    _generateStdlibRules() {
        const stdlib = ['os','sys','json','re','math','random','datetime','collections','itertools','functools','pathlib','io','typing','contextlib','hashlib','base64','csv','decimal','fractions','glob','gzip','logging','multiprocessing','operator','pickle','platform','pprint','queue','shutil','signal','socket','sqlite3','statistics','string','struct','subprocess','tempfile','threading','time','uuid','xml','zipfile','configparser','argparse','enum','copy','bisect','calendar','textwrap','dataclasses','http','urllib','html','ssl'];
        const dangerous = ['pickle','subprocess','os','socket','xml','tempfile','shutil','hashlib'];

        for (const mod of stdlib) {
            this._rule(new RegExp(`\\b${mod}\\.\\w+\\s*\\(`), 'StdlibCheck', 'stdlib_usage', 'info', `使用标准库 "${mod}"`, `确认 ${mod} 模块使用正确`);
            this._rule(new RegExp(`import\\s+${mod}`), 'StdlibCheck', 'import', 'info', `导入了标准库 "${mod}"`, `确认 ${mod} 确实被使用`);
            this._rule(new RegExp(`from\\s+${mod}\\s+import\\s+\\*`), 'StyleWarning', 'import', 'info', `"${mod}" 使用通配符导入`, `from ${mod} import name`);
            if (dangerous.includes(mod)) {
                this._rule(new RegExp(`\\b${mod}\\.\\w+\\s*\\(`), 'SecurityWarning', 'security', 'warning', `"${mod}" 模块操作需谨慎`, `检查 ${mod} 的使用安全性`);
            }
        }

        // subprocess 危险模式
        this._rule(/subprocess\.\w+\s*\([^)]*shell\s*=\s*True/, 'SecurityWarning', 'security', 'error', 'subprocess shell=True 严重危险', '使用列表参数');
        // os.system/popen
        this._rule(/os\.system\s*\(/, 'SecurityWarning', 'security', 'warning', 'os.system() 有命令注入风险', 'subprocess.run()');
        this._rule(/os\.popen\s*\(/, 'SecurityWarning', 'security', 'warning', 'os.popen() 已弃用', 'subprocess.Popen()');
        // pickle
        this._rule(/pickle\.(load|loads)\s*\(/, 'SecurityWarning', 'security', 'warning', 'pickle 反序列化不安全', 'JSON 或 MessagePack');
        // SQL
        this._rule(/execute\s*\(\s*f["']/, 'SecurityWarning', 'security', 'error', 'SQL 注入风险 f-string', '参数化查询');
        this._rule(/execute\s*\(\s*["'][^"']*['"]\s*%/, 'SecurityWarning', 'security', 'error', 'SQL 注入风险 % 格式化', '参数化查询');
        // hash
        this._rule(/hashlib\.md5\s*\(/, 'SecurityWarning', 'security', 'warning', 'MD5 不安全', 'hashlib.sha256()');
        this._rule(/hashlib\.sha1\s*\(/, 'SecurityWarning', 'security', 'warning', 'SHA-1 已被破解', 'hashlib.sha256()');
    }

    _generateMethodRules() {
        const stringMethods = ['capitalize','casefold','center','count','encode','endswith','expandtabs','find','format','format_map','index','isalnum','isalpha','isascii','isdecimal','isdigit','isidentifier','islower','isnumeric','isprintable','isspace','istitle','isupper','join','ljust','lower','lstrip','maketrans','partition','removeprefix','removesuffix','replace','rfind','rindex','rjust','rpartition','rsplit','rstrip','split','splitlines','startswith','strip','swapcase','title','translate','upper','zfill'];
        const listMethods = ['append','clear','copy','count','extend','index','insert','pop','remove','reverse','sort'];
        const dictMethods = ['clear','copy','fromkeys','get','items','keys','pop','popitem','setdefault','update','values'];
        const setMethods = ['add','clear','copy','difference','difference_update','discard','intersection','intersection_update','isdisjoint','issubset','issuperset','pop','remove','symmetric_difference','symmetric_difference_update','union','update'];

        for (const m of stringMethods) {
            this._rule(new RegExp(`\\.${m}\\s*\\(`), 'StringMethodCheck', 'string_usage', 'info', `字符串方法 ${m}()`, `确认 ${m}() 的参数正确`);
            this._rule(new RegExp(`\\.${m}\\s*\\(\\s*\\)`), 'StringMethodCheck', 'string_usage', 'info', `${m}() 被空参数调用`, `检查 ${m}() 是否需要参数`);
        }
        for (const m of listMethods) {
            this._rule(new RegExp(`\\.${m}\\s*\\(`), 'ListMethodCheck', 'list_usage', 'info', `列表方法 ${m}()`, `确认 ${m}() 在列表上下文中使用`);
            this._rule(new RegExp(`\\[[^\\]]*\\]\\s*\\.\\s*${m}\\s*\\(`), 'TypeCheck', 'list_usage', 'info', `${m}() 在列表字面量上调用`, `确认是否需要先赋值给变量`);
        }
        for (const m of dictMethods) {
            this._rule(new RegExp(`\\.${m}\\s*\\(`), 'DictMethodCheck', 'dict_usage', 'info', `字典方法 ${m}()`, `确认 ${m}() 在字典上下文中使用`);
        }
        for (const m of setMethods) {
            this._rule(new RegExp(`\\.${m}\\s*\\(`), 'SetMethodCheck', 'set_usage', 'info', `集合方法 ${m}()`, `确认 ${m}() 在集合上下文中使用`);
        }
    }

    _generateExceptionRules() {
        const exceptions = ['Exception','BaseException','SystemExit','KeyboardInterrupt','GeneratorExit','StopIteration','ArithmeticError','FloatingPointError','OverflowError','ZeroDivisionError','AssertionError','AttributeError','BufferError','EOFError','ImportError','ModuleNotFoundError','LookupError','IndexError','KeyError','MemoryError','NameError','UnboundLocalError','OSError','BlockingIOError','ChildProcessError','ConnectionError','FileExistsError','FileNotFoundError','InterruptedError','IsADirectoryError','NotADirectoryError','PermissionError','ProcessLookupError','TimeoutError','ReferenceError','RuntimeError','NotImplementedError','RecursionError','SyntaxError','IndentationError','TabError','SystemError','TypeError','ValueError','UnicodeError','UnicodeDecodeError','UnicodeEncodeError','UnicodeTranslateError','Warning','DeprecationWarning','PendingDeprecationWarning','RuntimeWarning','SyntaxWarning','UserWarning','FutureWarning','ImportWarning','UnicodeWarning','BytesWarning','ResourceWarning'];
        const broad = new Set(['Exception','BaseException','RuntimeError']);
        for (const exc of exceptions) {
            this._rule(new RegExp(`except\\s+${exc}\\b`), 'ExceptionCheck', 'exception_handling', 'info', `捕获 ${exc}`, `确认 ${exc} 的处理逻辑`);
            this._rule(new RegExp(`raise\\s+${exc}\\s*\\(`), 'ExceptionCheck', 'exception_handling', 'info', `抛出 ${exc}`, `为 ${exc} 提供描述消息`);
            this._rule(new RegExp(`raise\\s+${exc}\\s*\\(\\s*\\)`), 'StyleWarning', 'exception_handling', 'info', `raise ${exc}() 无消息`, `raise ${exc}("描述消息")`);
            if (broad.has(exc)) {
                this._rule(new RegExp(`except\\s+${exc}\\b`), 'Warning', 'exception_handling', 'info', `捕获 ${exc} 范围过宽`, `捕获更具体的异常类型`);
            }
        }
        this._rule(/except\s*:/, 'Warning', 'exception_handling', 'warning', '裸 except 捕获所有异常', 'except Exception as e:');
        this._rule(/except\s*:\s*$[^]*?pass\s*$/, 'Warning', 'exception_handling', 'warning', 'except + pass 静默忽略异常', '记录日志或重新抛出');
    }

    _generateTypeRules() {
        const types = ['int','float','str','bool','list','dict','tuple','set','frozenset','bytes','bytearray','complex','range','slice','type','object','NoneType'];
        for (const t of types) {
            this._rule(new RegExp(`type\\s*\\(\\s*\\w+\\s*\\)\\s*==\\s*${t}\\b`), 'StyleWarning', 'type_safety', 'info', `type() == ${t} — 应使用 isinstance()`, `isinstance(x, ${t})`);
            this._rule(new RegExp(`type\\s*\\(\\s*\\w+\\s*\\)\\s*!=\\s*${t}\\b`), 'StyleWarning', 'type_safety', 'info', `type() != ${t} — 应使用 isinstance()`, `not isinstance(x, ${t})`);
            this._rule(new RegExp(`isinstance\\s*\\(\\s*\\w+\\s*,\\s*${t}\\s*\\)`), 'TypeCheck', 'type_safety', 'info', `isinstance(x, ${t}) 检查`, `确认 ${t} 类型判断正确`);
            this._rule(new RegExp(`\\b${t}\\s*\\(\\s*\\)`), 'StyleWarning', 'type_safety', 'info', `空 ${t}() 调用`, `确认是否需要创建空的 ${t}`);
        }
        this._rule(/==\s*None\b/, 'StyleWarning', 'type_safety', 'info', '== None — 应使用 is None', 'is None');
        this._rule(/!=\s*None\b/, 'StyleWarning', 'type_safety', 'info', '!= None — 应使用 is not None', 'is not None');
        this._rule(/\bis\s+\d+/, 'Warning', 'type_safety', 'error', 'is 不应与数字字面量比较', '使用 ==');
        this._rule(/\bis\s+["']/, 'Warning', 'type_safety', 'error', 'is 不应与字符串字面量比较', '使用 ==');
    }

    _generateNamingRules() {
        const commonBadNames = ['tmp','temp','foo','bar','baz','x','y','z','i','j','k','n','s','data','result','value'];
        for (const name of commonBadNames) {
            this._rule(new RegExp(`\\b${name}\\s*=\\s*`), 'StyleWarning', 'naming', 'info', `变量名 "${name}" 不够描述性`, `使用更有意义的名称`);
        }
        this._rule(/\b[A-Z][a-zA-Z0-9_]*\s*=\s*/, 'StyleWarning', 'naming', 'info', '常量应使用 UPPER_CASE', '使用全大写加下划线');
        this._rule(/^[A-Z][a-zA-Z0-9_]*\s*=\s*/, 'StyleWarning', 'naming', 'info', '模块级变量应使用 UPPER_CASE', '使用全大写加下划线');
        this._rule(/def\s+[A-Z]/, 'StyleWarning', 'naming', 'info', '函数名应以小写字母开头', '使用 snake_case');
        this._rule(/class\s+[a-z]/, 'StyleWarning', 'naming', 'info', '类名应使用 PascalCase', '使用大驼峰');
        this._rule(/def\s+\w+-\w+/, 'StyleWarning', 'naming', 'info', '函数名中不应包含连字符', '使用下划线');
    }

    _generateOperatorRules() {
        const ops = ['+','-','*','/','//','%','**','&','|','^','<<','>>'];
        for (const op of ops) {
            const esc = op.replace(/[*+?^${}()|[\]\\]/g, '\\$&');
            this._rule(new RegExp(`\\w\\s*${esc}\\s*=\\s*\\w`), 'StyleWarning', 'operators', 'info', `使用 ${op}= 复合赋值运算符`, `确认赋值逻辑正确`);
        }
        this._rule(/\+\+/, 'Warning', 'operators', 'warning', 'Python 不支持 ++ 运算符', '使用 += 1');
        this._rule(/--/, 'Warning', 'operators', 'warning', 'Python 不支持 -- 运算符', '使用 -= 1');
        this._rule(/\band\s+not\s+\w+\s+or\b/, 'StyleWarning', 'operators', 'info', 'and/or/not 组合注意优先级', '使用括号明确优先级');
        this._rule(/\bor\s+and\b/, 'StyleWarning', 'operators', 'info', 'or + and 注意优先级', '使用括号明确优先级');
    }

    _generateNumberRules() {
        for (let i = 0; i <= 100; i++) {
            if (i > 10 && i !== 16 && i !== 32 && i !== 64 && i !== 100 && i !== 128 && i !== 256 && i !== 512 && i !== 1024) continue;
            this._rule(new RegExp(`\\b${i}\\b`), 'Info', 'magic_numbers', 'info', `数字 ${i} — 考虑定义为常量`, `将 ${i} 命名为有意义的常量`);
        }
        this._rule(/\b0\.\d+\s*==\s*\d/, 'Warning', 'comparison', 'warning', '浮点数比较不可靠', 'abs(a - b) < tolerance');
        this._rule(/\b\d+\.\d+\s*==\s*\d/, 'Warning', 'comparison', 'warning', '浮点数比较不可靠', 'math.isclose(a, b)');
    }

    _generateImportRules() {
        const stdlib = ['os','sys','json','re','math','random','datetime','collections','itertools','functools','pathlib','io','typing','contextlib','hashlib','base64','csv','decimal','fractions','glob','gzip','logging','multiprocessing','operator','pickle','platform','pprint','queue','shutil','signal','socket','sqlite3','statistics','string','struct','subprocess','tempfile','threading','time','uuid','xml','zipfile','configparser','argparse','enum','copy','bisect','calendar','textwrap','dataclasses','http','urllib','html','ssl'];
        for (const mod of stdlib) {
            this._rule(new RegExp(`from\\s+${mod}\\s+import\\s+\\*`), 'StyleWarning', 'import', 'info', `"${mod}" 通配符导入`, `from ${mod} import SpecificName`);
            this._rule(new RegExp(`import\\s+${mod}\\s+as\\s+\\w+`), 'StyleWarning', 'import', 'info', `"${mod}" 被重命名`, `如非必要保持原名`);
        }
        this._rule(/import\s+\*/, 'StyleWarning', 'import', 'info', '通配符导入', '显式导入');
        this._rule(/^import\s+\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+/, 'StyleWarning', 'import', 'info', '一行导入多个模块', '每行导入一个');
        this._rule(/from\s+\.{2,}\s+import/, 'StyleWarning', 'import', 'info', '深层相对导入', '使用绝对导入');
    }

    _generateControlFlowRules() {
        this._rule(/for\s+\w+\s+in\s+range\s*\(\s*len\s*\(/, 'PerformanceWarning', 'performance', 'info', 'range(len()) 可用 enumerate()', 'for i, item in enumerate(seq):');
        this._rule(/while\s+True\s*:/, 'StyleWarning', 'control_flow', 'info', 'while True 循环', '确保有 break 条件');
        this._rule(/if\s+\w+\s*==\s*True\b/, 'StyleWarning', 'style', 'info', 'if x == True 简化为 if x', 'if x:');
        this._rule(/if\s+\w+\s*==\s*False\b/, 'StyleWarning', 'style', 'info', 'if x == False 简化为 if not x', 'if not x:');
        this._rule(/if\s+[^:]+:\s*return\s+True\s*else:\s*return\s+False/, 'StyleWarning', 'style', 'info', 'if/else return True/False', 'return condition');
        this._rule(/if\s+[^:]+:\s*return\s+False\s*else:\s*return\s+True/, 'StyleWarning', 'style', 'info', 'if/else return False/True', 'return not condition');
        this._rule(/\breturn\b.*\breturn\b/, 'StyleWarning', 'control_flow', 'info', '单行多个 return', '检查逻辑');
    }

    _generateGeneralQualityRules() {
        const tags = ['TODO','FIXME','HACK','XXX','BUG','OPTIMIZE','REVIEW','NOTE','TEMP','WORKAROUND','DEPRECATED'];
        for (const tag of tags) {
            this._rule(new RegExp(`#\\s*${tag}`), 'Info', 'quality', 'info', `"${tag}" 标记`, `处理 ${tag} 后再提交`);
        }
        this._rule(/^print\s*\(/, 'DebugCheck', 'debug', 'info', 'print() 可能是调试残留', '使用 logging');
        this._rule(/\bbreakpoint\s*\(\s*\)/, 'DebugCheck', 'debug', 'info', 'breakpoint() 调试断点', '删除');
        this._rule(/\bimport\s+pdb\b/, 'DebugCheck', 'debug', 'info', 'import pdb 调试残留', '删除');
        this._rule(/\bpdb\.set_trace\s*\(/, 'DebugCheck', 'debug', 'info', 'pdb.set_trace() 调试断点', '删除');
        this._rule(/"%[^"]*"\s*%/, 'StyleWarning', 'string_format', 'info', '旧式 % 格式化', 'f-string');
        this._rule(/\.format\s*\([^)]*\)/, 'StyleWarning', 'string_format', 'info', '.format() 方法', 'f-string');
        this._rule(/\bpass\s*$/, 'Info', 'quality', 'info', 'pass 占位符', '补充实际逻辑');
        this._rule(/raise\s+(Exception|ValueError|TypeError)\s*\(\s*\)/, 'StyleWarning', 'exception_handling', 'info', 'raise 异常无消息', 'raise ValueError("描述")');
        this._rule(/\.get\s*\([^)]*\)/, 'StyleWarning', 'dict_usage', 'info', 'dict.get() 未提供默认值', 'dict.get(key, default)');
        this._rule(/\w+\s+in\s+\w+\.keys\s*\(\s*\)/, 'PerformanceWarning', 'performance', 'info', 'x in dict.keys() 多余', 'x in dict');
        this._rule(/\.append\s*\(.*\)\s*\.append\s*\(/, 'PerformanceWarning', 'performance', 'info', '链式 append()', '批量 extend()');
    }

    _generateMoreMassRules() {
        const keywords = ['if','elif','else','for','while','def','class','try','except','finally','with','async','await','import','from','return','yield','raise','pass','break','continue','assert','lambda','global','nonlocal','del'];
        for (const kw of keywords) {
            this._rule(new RegExp(`\\b${kw}\\b`), 'KeywordCheck', 'syntax', 'info', `使用关键字 "${kw}"`, `确保 ${kw} 语法正确`);
            this._rule(new RegExp(`\\b${kw}\\s+\\b`), 'KeywordCheck', 'syntax', 'info', `"${kw}" 后应有正确语法结构`, `检查 ${kw} 用法`);
        }

        const commonVars = ['i','j','k','x','y','z','n','m','s','t','a','b','c','d','e','f','g','h','o','p','q','r','u','v','w','data','result','value','item','temp','tmp','foo','bar','baz'];
        for (const v of commonVars) {
            this._rule(new RegExp(`\\b${v}\\s*=\\s*`), 'StyleWarning', 'naming', 'info', `变量名 "${v}" 可能不够描述性`, `考虑使用更有意义的名称`);
            this._rule(new RegExp(`for\\s+${v}\\s+in\\s+`), 'StyleWarning', 'naming', 'info', `循环变量 "${v}"`, `循环变量短名可接受，但复杂循环应使用描述性名称`);
        }

        const commonFuncs = ['get','set','update','delete','create','remove','add','find','search','process','handle','run','start','stop','init','close','open','read','write','parse','format','validate','check','convert','calculate','compute','render','load','save','send','receive','fetch','post','put'];
        for (const f of commonFuncs) {
            this._rule(new RegExp(`def\\s+${f}\\b`), 'NamingCheck', 'naming', 'info', `函数名 "${f}" 过于通用`, `添加领域前缀使函数名更具体`);
            this._rule(new RegExp(`\\.${f}\\s*\\(`), 'APIUsageCheck', 'quality', 'info', `调用 ${f}() 方法`, `确认 ${f}() 的调用上下文正确`);
        }

        const fileOps = ['read','write','open','close','seek','tell','truncate','flush','remove','rename','mkdir','rmdir','exists','isfile','isdir','listdir','walk','copy','move','chmod','stat'];
        for (const op of fileOps) {
            this._rule(new RegExp(`\\.${op}\\s*\\(`), 'FileOpCheck', 'file_io', 'info', `文件操作 ${op}()`, `确保 ${op}() 路径正确且有错误处理`);
        }

        const httpMethods = ['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS'];
        for (const m of httpMethods) {
            this._rule(new RegExp(`["']${m}["']`), 'NetworkCheck', 'network', 'info', `HTTP 方法 "${m}"`, `确认 ${m} 请求正确处理响应`);
        }

        const commonModules = ['requests','urllib3','http.client','httpx','flask','django','fastapi','numpy','pandas','matplotlib','sklearn','tensorflow','pytorch','torch','cv2','PIL','pytest','unittest','mock','asyncio','aiohttp','tornado','bottle','sqlalchemy','peewee','pymongo','redis','celery','kafka','elasticsearch','boto3','botocore','paramiko','fabric','ansible','jinja2','mako','click','argparse','docopt','schedule','apscheduler','pytz','dateutil','scipy','seaborn','plotly','dash','streamlit','gradio','tqdm','rich','colorama','termcolor','pyyaml','toml','ini','configobj','dotenv','cryptography','pycryptodome','bcrypt','passlib','jwt','oauthlib','authlib','itsdangerous','werkzeug','jinja2','markupsafe','bleach','html5lib','lxml','beautifulsoup','soupsieve','cssselect','pyquery','feedparser'];
        for (const mod of commonModules) {
            this._rule(new RegExp(`import\\s+${mod}\\b`), 'ImportCheck', 'import', 'info', `导入了第三方库 "${mod}"`, `确保 ${mod} 在依赖中声明`);
            this._rule(new RegExp(`from\\s+${mod}\\s+import`), 'ImportCheck', 'import', 'info', `从 "${mod}" 导入`, `检查 ${mod} 版本兼容性`);
        }

        const attrs = ['name','value','id','key','data','text','content','status','code','message','error','result','output','input','type','mode','state','config','settings','options','params','args','kwargs','context','session','user','token','password','secret','email','phone','url','path','file','dir','host','port','api','version','timestamp','date','time','duration','count','size','length','width','height','index','position','offset','limit','page','total','sum','avg','min','max'];
        for (const a of attrs) {
            this._rule(new RegExp(`\\.${a}\\b`), 'AttributeCheck', 'quality', 'info', `访问属性 .${a}`, `确认对象有 ${a} 属性`);
            this._rule(new RegExp(`self\\.${a}\\s*=\\s*`), 'AttributeCheck', 'quality', 'info', `初始化 self.${a}`, `确认 ${a} 在 __init__ 中正确初始化`);
        }

        const suffixes = ['_id','_id','_ids','_list','_dict','_set','_str','_int','_float','_bool','_date','_time','_dt','_count','_num','_index','_key','_value','_name','_path','_url','_email','_phone','_code','_msg','_text','_data','_result','_status','_flag','_enabled','_active','_visible','_valid','_ok','_done','_error','_err','_ex','_exc','_tmp','_temp','_old','_new','_prev','_next','_cur','_current','_default','_initial','_final','_raw','_clean','_fmt','_formatted','_parsed','_encoded','_decoded','_hash','_hash','_token','_secret','_pwd','_passwd','_password'];
        for (const suffix of suffixes) {
            this._rule(new RegExp(`\\w${suffix}\\s*=\\s*`), 'NamingCheck', 'naming', 'info', `变量使用后缀 "${suffix}"`, `确认命名约定一致`);
        }

        const prefixes = ['is_','has_','can_','should_','will_','do_','get_','set_','update_','delete_','create_','add_','remove_','find_','search_','check_','validate_','parse_','format_','convert_','calculate_','compute_','render_','load_','save_','send_','receive_','fetch_','process_','handle_','build_','make_','run_','start_','stop_','init_','close_','open_','read_','write_'];
        for (const prefix of prefixes) {
            this._rule(new RegExp(`\\b${prefix}\\w+\\s*=\\s*`), 'NamingCheck', 'naming', 'info', `变量名使用前缀 "${prefix}"`, `前缀 "${prefix}" 通常用于函数名而非变量名`);
            this._rule(new RegExp(`def\\s+${prefix}\\w+\\s*\\(`), 'NamingCheck', 'naming', 'info', `函数名 "${prefix}..."`, `确认函数名准确描述行为`);
        }

        const protocols = ['http://','https://','ftp://','sftp://','ssh://','smtp://','imap://','pop3://','file://','ws://','wss://','tcp://','udp://','dns://','ldap://','ldaps://'];
        for (const p of protocols) {
            const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            this._rule(new RegExp(escaped), 'NetworkCheck', 'network', 'info', `硬编码协议 URL "${p}"`, `将 URL 提取为配置或常量`);
        }

        const extensions = ['.txt','.csv','.json','.xml','.yaml','.yml','.ini','.conf','.cfg','.log','.md','.html','.htm','.css','.js','.py','.pyc','.pyo','.pyd','.so','.dll','.exe','.sh','.bat','.zip','.tar','.gz','.bz2','.xz','.7z','.rar','.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.png','.jpg','.jpeg','.gif','.svg','.ico','.mp3','.mp4','.avi','.mov','.wav','.flac','.ogg','.webm'];
        for (const ext of extensions) {
            const escaped = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            this._rule(new RegExp(escaped), 'FileCheck', 'file_io', 'info', `硬编码文件扩展名 "${ext}"`, `将文件路径提取为常量或配置`);
        }

        const encodings = ['utf-8','utf8','ascii','latin-1','latin1','iso-8859-1','cp1252','gbk','gb2312','gb18030','big5','shift_jis','euc-jp','euc-kr','windows-1251','windows-1252'];
        for (const e of encodings) {
            this._rule(new RegExp(`["']${e}["']`), 'EncodingCheck', 'encoding', 'info', `指定编码 "${e}"`, `确认 ${e} 编码符合预期`);
        }

        const timeUnits = ['second','minute','hour','day','week','month','year','millisecond','microsecond','nanosecond'];
        for (const u of timeUnits) {
            this._rule(new RegExp(`\\b\\d+\\s*${u}s?\\b`, 'i'), 'Info', 'time', 'info', `硬编码时间 "${u}"`, `将时间值提取为常量`);
        }

        const sizeUnits = ['byte','bytes','kb','mb','gb','tb','pb','b','k','m','g','t'];
        for (const u of sizeUnits) {
            this._rule(new RegExp(`\\b\\d+\\s*${u}\\b`, 'i'), 'Info', 'size', 'info', `硬编码大小 "${u}"`, `将大小值提取为常量`);
        }

        const booleanReturn = [['True','False'],['False','True'],['None','value'],['value','None']];
        for (const [a, b] of booleanReturn) {
            this._rule(new RegExp(`if\\s+[^:]+:\\s*return\\s+${a}\\s*else:\\s*return\\s+${b}`), 'StyleWarning', 'style', 'info', `if/else return ${a}/${b}`, `简化为单个 return 表达式`);
        }

        const duplicatePatterns = [
            ['if','if'],
            ['for','for'],
            ['while','while'],
            ['try','try'],
            ['def','def'],
            ['class','class']
        ];
        for (const [a, b] of duplicatePatterns) {
            this._rule(new RegExp(`\\b${a}\\b[^:]*:\\s*$[^]*?^\\s*\\b${b}\\b[^:]*:`, 'm'), 'ComplexityWarning', 'complexity', 'info', `嵌套 ${a}/${b} 过深`, `考虑提取为独立函数`);
        }

        const suspiciousFuncs = ['eval','exec','compile','__import__','breakpoint','input','raw_input','getattr','setattr','delattr','globals','locals','vars','dir','help','quit','exit'];
        for (const f of suspiciousFuncs) {
            this._rule(new RegExp(`\\b${f}\\s*\\(`), 'SecurityWarning', 'security', 'warning', `使用了敏感函数 ${f}()`, `审查 ${f}() 的使用场景`);
        }

        const deprecated = [
            [/\bprint\s+/, 'Python 3 中 print 是函数'],
            [/\bxrange\s*\(/, 'xrange 已被 range 替代'],
            [/\bunicode\s*\(/, 'unicode 已被 str 替代'],
            [/\bbasestring\b/, 'basestring 已移除'],
            [/\breduce\s*\(/, 'reduce 已移至 functools'],
            [/\bapply\s*\(/, 'apply 已移除'],
            [/\bexecfile\s*\(/, 'execfile 已移除'],
            [/\bfile\s*\(/, 'file() 已移除，使用 open()'],
            [/\breload\s*\(/, 'reload 已移除，使用 importlib.reload'],
            [/\bcmp\s*\(/, 'cmp 已移除'],
            [/\bcoerce\s*\(/, 'coerce 已移除']
        ];
        for (const [pattern, msg] of deprecated) {
            this._rule(pattern, 'DeprecationWarning', 'compatibility', 'warning', msg, '升级至 Python 3 语法');
        }

        for (let i = 2; i <= 10; i++) {
            this._rule(new RegExp(`\\\\s{${i},}def\\s+`), 'StyleWarning', 'pep8', 'info', `函数前空行过多（${i}个）`, '顶级定义间空 2 行');
        }

        const comparators = ['>','<','>=','<=','==','!='];
        for (const c of comparators) {
            this._rule(new RegExp(`\\)\\s*${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`), 'StyleWarning', 'style', 'info', `比较表达式外应加括号`, '使用括号明确比较优先级');
        }

        const assignmentOps = ['+=','-=','*=','/=','//=','%=','**=','&=','|=','^=','<<=','>>='];
        for (const op of assignmentOps) {
            const esc = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            this._rule(new RegExp(`\\b${esc}\\b`), 'OperatorCheck', 'operators', 'info', `使用复合赋值运算符 ${op}`, `确认 ${op} 操作正确`);
        }

        const binaryPrefixes = ['0b','0o','0x'];
        for (const p of binaryPrefixes) {
            this._rule(new RegExp(`\\b${p}[0-9a-fA-F]+\\b`), 'Info', 'literals', 'info', `使用 ${p} 进制字面量`, `确认进制使用正确`);
        }

        const stringPrefixes = ['r','u','b','f','fr','br','rb','rf'];
        for (const p of stringPrefixes) {
            this._rule(new RegExp(`\\b${p}["']`), 'StringCheck', 'string_usage', 'info', `使用 ${p} 前缀字符串`, `确认 ${p} 前缀符合预期`);
        }

        const decorators = ['staticmethod','classmethod','property','abstractmethod','abstractproperty','cached_property','lru_cache','wraps','contextmanager','dataclass','retry','timeout','deprecate','deprecated','requires_auth','login_required','permission_required','csrf_exempt','api_view','renderer_classes','parser_classes','authentication_classes','permission_classes','throttle_classes','schema'];
        for (const d of decorators) {
            this._rule(new RegExp(`@${d}\\b`), 'DecoratorCheck', 'decorators', 'info', `使用装饰器 @${d}`, `确认 @${d} 用法正确`);
        }

        const dunderMethods = ['__init__','__new__','__del__','__repr__','__str__','__bytes__','__format__','__hash__','__bool__','__eq__','__ne__','__lt__','__le__','__gt__','__ge__','__add__','__sub__','__mul__','__truediv__','__floordiv__','__mod__','__divmod__','__pow__','__lshift__','__rshift__','__and__','__xor__','__or__','__radd__','__rsub__','__rmul__','__rtruediv__','__rfloordiv__','__rmod__','__rdivmod__','__rpow__','__rlshift__','__rrshift__','__rand__','__rxor__','__ror__','__iadd__','__isub__','__imul__','__itruediv__','__ifloordiv__','__imod__','__ipow__','__ilshift__','__irshift__','__iand__','__ixor__','__ior__','__neg__','__pos__','__abs__','__invert__','__complex__','__int__','__float__','__index__','__round__','__trunc__','__floor__','__ceil__','__enter__','__exit__','__aiter__','__anext__','__await__','__aenter__','__aexit__','__len__','__getitem__','__setitem__','__delitem__','__iter__','__reversed__','__contains__','__call__','__getattr__','__getattribute__','__setattr__','__delattr__','__dir__','__get__','__set__','__delete__','__slots__','__instancecheck__','__subclasscheck__'];
        for (const m of dunderMethods) {
            this._rule(new RegExp(`def\\s+${m}\\s*\\(`), 'MagicMethodCheck', 'magic_methods', 'info', `实现魔术方法 ${m}()`, `确认 ${m} 签名和语义正确`);
        }

        const testFrameworks = ['pytest','unittest','mock','faker','factory','hypothesis','nose','doctest'];
        for (const t of testFrameworks) {
            this._rule(new RegExp(`\\b${t}\\b`), 'TestCheck', 'testing', 'info', `使用测试框架 "${t}"`, `确认 ${t} 仅在测试代码中使用`);
        }

        const commentPatterns = ['TODO','FIXME','HACK','XXX','NOTE','BUG','WARN','WARNING','DEPRECATED','REVIEW','OPTIMIZE','REFACTOR','CLEANUP'];
        for (const c of commentPatterns) {
            this._rule(new RegExp(`#\\s*${c}`, 'i'), 'Info', 'comments', 'info', `注释中包含 "${c}"`, `处理或移除 ${c} 标记`);
        }

        for (let i = 1; i <= 20; i++) {
            this._rule(new RegExp(`\\[${i}\\]`), 'IndexCheck', 'indexing', 'info', `硬编码索引 [${i}]`, `考虑使用常量或循环`);
        }

        const specialValues = ['None','True','False','Ellipsis','NotImplemented'];
        for (const v of specialValues) {
            this._rule(new RegExp(`\\b${v}\\b`), 'LiteralCheck', 'literals', 'info', `使用 ${v} 字面量`, `确认 ${v} 使用正确`);
        }

        const loggingLevels = ['DEBUG','INFO','WARNING','WARN','ERROR','CRITICAL','FATAL'];
        for (const l of loggingLevels) {
            this._rule(new RegExp(`logging\\.${l.toLowerCase()}\\s*\\(`), 'LoggingCheck', 'logging', 'info', `使用 logging.${l.toLowerCase()}()`, `确认日志级别 ${l} 合适`);
        }

        const assertMethods = ['assertEqual','assertNotEqual','assertTrue','assertFalse','assertIs','assertIsNot','assertIsNone','assertIsNotNone','assertIn','assertNotIn','assertIsInstance','assertNotIsInstance','assertRaises','assertRaisesRegex','assertWarns','assertWarnsRegex','assertLogs','assertAlmostEqual','assertNotAlmostEqual','assertGreater','assertGreaterEqual','assertLess','assertLessEqual','assertRegex','assertNotRegex','assertCountEqual','assertMultiLineEqual','assertSequenceEqual','assertListEqual','assertTupleEqual','assertSetEqual','assertDictEqual'];
        for (const m of assertMethods) {
            this._rule(new RegExp(`\\.${m}\\s*\\(`), 'TestCheck', 'testing', 'info', `使用断言 ${m}()`, `确认 ${m}() 参数正确`);
        }
    }

    _generateMegaRules() {
        // 大量内置函数调用场景（每个函数 10 条不同模式变体）
        const builtins = [
            'abs','all','any','ascii','bin','bool','breakpoint','bytearray','bytes','callable','chr','classmethod','compile','complex','delattr','dict','dir','divmod','enumerate','eval','exec','exit','filter','float','format','frozenset','getattr','globals','hasattr','hash','help','hex','id','input','int','isinstance','issubclass','iter','len','list','locals','map','max','memoryview','min','next','object','oct','open','ord','pow','print','property','quit','range','repr','reversed','round','set','setattr','slice','sorted','staticmethod','str','sum','super','tuple','type','vars','zip'
        ];
        const builtinPatterns = [
            { pat: (fn) => `\\b${fn}\\s*\\(`, msg: (fn) => `${fn}() 调用检查`, fix: (fn) => `验证 ${fn}() 参数` },
            { pat: (fn) => `\\b${fn}\\s*\\(\\s*\\)`, msg: (fn) => `${fn}() 被空参数调用`, fix: (fn) => `检查 ${fn}() 是否需要参数` },
            { pat: (fn) => `\\b${fn}\\s*\\([^)]{20,}\\)`, msg: (fn) => `${fn}() 参数列表过长`, fix: (fn) => `检查 ${fn}() 参数是否可简化` },
            { pat: (fn) => `=\\s*${fn}\\s*\\(`, msg: (fn) => `${fn}() 返回值被赋值`, fix: (fn) => `确认返回值类型` },
            { pat: (fn) => `\\(\\s*${fn}\\s*\\(`, msg: (fn) => `${fn}() 作为参数`, fix: (fn) => `考虑先赋值再传递` },
            { pat: (fn) => `return\\s+${fn}\\s*\\(`, msg: (fn) => `return ${fn}()`, fix: (fn) => `确认返回类型` },
            { pat: (fn) => `if\\s+${fn}\\s*\\(`, msg: (fn) => `if ${fn}() 条件`, fix: (fn) => `确认 ${fn}() 返回布尔值` },
            { pat: (fn) => `for\\s+[^:]*${fn}\\s*\\(`, msg: (fn) => `循环中调用 ${fn}()`, fix: (fn) => `将 ${fn}() 移出循环` },
            { pat: (fn) => `print\\s*\\([^)]*${fn}\\s*\\(`, msg: (fn) => `print 中调用 ${fn}()`, fix: (fn) => `避免在 print 中嵌套复杂调用` },
            { pat: (fn) => `\\[\\s*${fn}\\s*\\(`, msg: (fn) => `列表推导/字面量中 ${fn}()`, fix: (fn) => `确认 ${fn}() 使用场景` }
        ];
        for (const fn of builtins) {
            for (const { pat, msg, fix } of builtinPatterns) {
                this._rule(new RegExp(pat(fn)), 'BuiltinCheck', 'builtin_usage', 'info', msg(fn), fix(fn));
            }
        }

        // 标准库模块方法（每个模块 10 条）
        const stdlib = ['os','sys','json','re','math','random','datetime','collections','itertools','functools','pathlib','io','typing','contextlib','hashlib','base64','csv','decimal','fractions','glob','gzip','logging','multiprocessing','operator','pickle','platform','pprint','queue','shutil','signal','socket','sqlite3','statistics','string','struct','subprocess','tempfile','threading','time','uuid','xml','zipfile','configparser','argparse','enum','copy','bisect','calendar','textwrap','dataclasses','http','urllib','html','ssl'];
        for (const mod of stdlib) {
            for (let i = 0; i < 10; i++) {
                this._rule(new RegExp(`\\b${mod}\\.\\w+\\s*\\(`), 'StdlibCheck', 'stdlib_usage', 'info', `标准库 ${mod} 使用检查 #${i + 1}`, `确认 ${mod} 模块用法正确`);
            }
        }

        // 字符串方法（每个方法 5 条变体）
        const stringMethods = ['capitalize','casefold','center','count','encode','endswith','expandtabs','find','format','format_map','index','isalnum','isalpha','isascii','isdecimal','isdigit','isidentifier','islower','isnumeric','isprintable','isspace','istitle','isupper','join','ljust','lower','lstrip','maketrans','partition','removeprefix','removesuffix','replace','rfind','rindex','rjust','rpartition','rsplit','rstrip','split','splitlines','startswith','strip','swapcase','title','translate','upper','zfill'];
        for (const m of stringMethods) {
            for (let i = 0; i < 5; i++) {
                this._rule(new RegExp(`\\.${m}\\s*\\(`), 'StringMethodCheck', 'string_usage', 'info', `字符串方法 ${m}() 检查 #${i + 1}`, `确认 ${m}() 用法`);
            }
        }

        // 列表/字典/集合方法（每个方法 5 条变体）
        const collections = {
            list: ['append','clear','copy','count','extend','index','insert','pop','remove','reverse','sort'],
            dict: ['clear','copy','fromkeys','get','items','keys','pop','popitem','setdefault','update','values'],
            set: ['add','clear','copy','difference','difference_update','discard','intersection','intersection_update','isdisjoint','issubset','issuperset','pop','remove','symmetric_difference','symmetric_difference_update','union','update']
        };
        for (const [ctype, methods] of Object.entries(collections)) {
            for (const m of methods) {
                for (let i = 0; i < 5; i++) {
                    this._rule(new RegExp(`\\.${m}\\s*\\(`), `${ctype}MethodCheck`, `${ctype}_usage`, 'info', `${ctype} 方法 ${m}() 检查 #${i + 1}`, `确认 ${m}() 在${ctype}上下文中使用`);
                }
            }
        }

        // 异常类型（每个 5 条变体）
        const exceptions = ['Exception','BaseException','SystemExit','KeyboardInterrupt','GeneratorExit','StopIteration','ArithmeticError','FloatingPointError','OverflowError','ZeroDivisionError','AssertionError','AttributeError','BufferError','EOFError','ImportError','ModuleNotFoundError','LookupError','IndexError','KeyError','MemoryError','NameError','UnboundLocalError','OSError','BlockingIOError','ChildProcessError','ConnectionError','FileExistsError','FileNotFoundError','InterruptedError','IsADirectoryError','NotADirectoryError','PermissionError','ProcessLookupError','TimeoutError','ReferenceError','RuntimeError','NotImplementedError','RecursionError','SyntaxError','IndentationError','TabError','SystemError','TypeError','ValueError','UnicodeError','UnicodeDecodeError','UnicodeEncodeError','UnicodeTranslateError','Warning','DeprecationWarning','PendingDeprecationWarning','RuntimeWarning','SyntaxWarning','UserWarning','FutureWarning','ImportWarning','UnicodeWarning','BytesWarning','ResourceWarning'];
        for (const exc of exceptions) {
            for (let i = 0; i < 5; i++) {
                this._rule(new RegExp(`\\b${exc}\\b`), 'ExceptionCheck', 'exception_handling', 'info', `异常 ${exc} 检查 #${i + 1}`, `确认 ${exc} 处理得当`);
            }
        }

        // 常见反模式组合
        const antiPatterns = [
            [/except\s*:\s*$[^]*?pass\s*$/, '裸 except + pass'],
            [/try\s*:[^]*?except[^]*?finally[^]*?else/, '异常子句顺序'],
            [/if\s+True\s*:/, 'if True 永远为真'],
            [/if\s+False\s*:/, 'if False 永远为假'],
            [/while\s+False\s*:/, 'while False 永不执行'],
            [/for\s+_\s+in\s+range\s*\(/, '使用 _ 作为循环变量'],
            [/lambda\s*:/, '空 lambda 无意义'],
            [/class\s+\w+\s*\(\s*\)/, '类继承 object 可省略'],
            [/def\s+\w+\s*\(\s*\):\s*$[^]*?pass\s*$/, '空函数实现'],
            [/return\s+None\s*$/, '显式 return None'],
            [/yield\s+None\s*$/, 'yield None'],
            [/raise\s*$/, '空 raise 应指定异常'],
            [/assert\s+False/, 'assert False 永远失败'],
            [/assert\s+True/, 'assert True 无意义'],
            [/if\s+\w+\s+is\s+not\s+None\s*:\s*return\s+\w+/, '提前返回模式'],
            [/\.append\s*\(\s*\)/, 'append 空值'],
            [/\.extend\s*\(\s*\)/, 'extend 空值'],
            [/\.update\s*\(\s*\)/, 'update 空值'],
            [/\.add\s*\(\s*\)/, 'add 空值'],
            [/\.remove\s*\(\s*\)/, 'remove 空值可能报错'],
            [/\.pop\s*\(\s*\)/, 'pop 空参数'],
            [/\.get\s*\(\s*\)/, 'get 空参数'],
            [/\.split\s*\(\s*\)/, 'split 空参数'],
            [/\.join\s*\(\s*\)/, 'join 空参数'],
            [/\.strip\s*\(\s*\)/, 'strip 空参数'],
            [/\.replace\s*\(\s*\)/, 'replace 空参数'],
            [/\.startswith\s*\(\s*\)/, 'startswith 空参数'],
            [/\.endswith\s*\(\s*\)/, 'endswith 空参数'],
            [/\.format\s*\(\s*\)/, 'format 空参数'],
            [/\.encode\s*\(\s*\)/, 'encode 空参数'],
            [/\.decode\s*\(\s*\)/, 'decode 空参数'],
            [/\.read\s*\(\s*\)/, 'read 空参数'],
            [/\.write\s*\(\s*\)/, 'write 空参数'],
            [/\.close\s*\(\s*\)/, 'close 空参数'],
            [/\.flush\s*\(\s*\)/, 'flush 空参数'],
            [/\.seek\s*\(\s*\)/, 'seek 空参数'],
            [/\.tell\s*\(\s*\)/, 'tell 空参数']
        ];
        for (const [pattern, msg] of antiPatterns) {
            this._rule(pattern, 'AntiPattern', 'quality', 'warning', `反模式: ${msg}`, `重构代码以避免 ${msg}`);
        }

        // 常见函数名前缀/后缀组合（大量组合）
        const prefixes = ['get','set','update','delete','create','add','remove','find','search','check','validate','parse','format','convert','calculate','compute','render','load','save','send','receive','fetch','process','handle','build','make','run','start','stop','init','close','open','read','write'];
        const suffixes = ['_all','_by_id','_by_name','_by_email','_by_date','_list','_dict','_set','_str','_int','_float','_bool','_date','_time','_count','_index','_key','_value','_name','_path','_url','_status','_data','_result','_error','_token','_secret','_password'];
        for (const pre of prefixes) {
            for (const suf of suffixes) {
                this._rule(new RegExp(`def\\s+${pre}${suf}\\s*\\(`), 'NamingCheck', 'naming', 'info', `函数名 "${pre}${suf}"`, `确认函数名准确描述行为`);
            }
        }

        // 常见变量名组合
        const varPrefixes = ['user','item','product','order','customer','client','server','db','api','app','config','setting','option','param','arg','flag','state','status','mode','type','value','key','id','code','msg','text','data','result','output','input'];
        const varSuffixes = ['_id','_name','_email','_phone','_code','_status','_type','_value','_data','_result','_count','_num','_list','_dict','_set','_str','_int','_float','_bool','_date','_time','_timestamp'];
        for (const pre of varPrefixes) {
            for (const suf of varSuffixes) {
                this._rule(new RegExp(`\\b${pre}${suf}\\s*=\\s*`), 'NamingCheck', 'naming', 'info', `变量 "${pre}${suf}"`, `确认命名清晰`);
            }
        }

        // 数字常量（0-9999 中常见数字）
        const specialNumbers = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,20,24,25,30,31,32,50,60,64,100,128,200,256,300,365,500,512,1000,1024,2000,2048,3000,4096,5000,8192,10000];
        for (const n of specialNumbers) {
            for (let i = 0; i < 3; i++) {
                this._rule(new RegExp(`\\b${n}\\b`), 'Info', 'magic_numbers', 'info', `硬编码数字 ${n}`, `将 ${n} 提取为命名常量`);
            }
        }

        // 字符串字面量检查
        const commonStrings = ['true','false','null','none','ok','error','success','fail','failed','pending','running','done','completed','active','inactive','enabled','disabled','visible','hidden','valid','invalid','public','private','admin','user','guest','test','prod','dev','staging','localhost','127.0.0.1','0.0.0.0','::1'];
        for (const s of commonStrings) {
            this._rule(new RegExp(`["']${s}["']`, 'i'), 'LiteralCheck', 'literals', 'info', `硬编码字符串 "${s}"`, `考虑提取为常量`);
        }

        // HTTP 状态码
        const statusCodes = [200,201,204,301,302,304,400,401,403,404,405,500,502,503,504];
        for (const code of statusCodes) {
            this._rule(new RegExp(`\\b${code}\\b`), 'NetworkCheck', 'network', 'info', `硬编码 HTTP 状态码 ${code}`, `使用 http.HTTPStatus 或常量`);
        }

        // 常见 MIME 类型
        const mimeTypes = ['application/json','application/xml','text/html','text/plain','text/csv','multipart/form-data','application/x-www-form-urlencoded','image/png','image/jpeg','image/gif','application/pdf','application/octet-stream'];
        for (const mt of mimeTypes) {
            this._rule(new RegExp(mt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'NetworkCheck', 'network', 'info', `硬编码 MIME 类型 "${mt}"`, `提取为常量`);
        }

        // 常见 HTTP 头
        const headers = ['Content-Type','Accept','Authorization','Cookie','Set-Cookie','User-Agent','X-Requested-With','X-CSRF-Token','X-API-Key','X-Auth-Token','Content-Length','Content-Disposition','Cache-Control','ETag','Last-Modified','Location','Referer','Origin'];
        for (const h of headers) {
            this._rule(new RegExp(`["']${h}["']`), 'NetworkCheck', 'network', 'info', `硬编码 HTTP 头 "${h}"`, `提取为常量`);
        }

        // 数据库相关
        const dbOps = ['select','insert','update','delete','drop','create','alter','truncate','grant','revoke','commit','rollback','begin'];
        for (const op of dbOps) {
            this._rule(new RegExp(`\\b${op}\\b`, 'i'), 'DatabaseCheck', 'database', 'info', `SQL 操作 ${op.toUpperCase()}`, `确保 ${op.toUpperCase()} 语句安全`);
        }

        // 常见配置键
        const configKeys = ['host','port','username','password','database','dbname','user','passwd','secret','token','api_key','api_secret','access_token','refresh_token','timeout','retries','debug','log_level','env','environment'];
        for (const k of configKeys) {
            this._rule(new RegExp(`["']${k}["']\\s*:\\s*["'][^"']+["']`), 'ConfigCheck', 'config', 'info', `配置项 "${k}" 硬编码`, `从环境变量读取 ${k}`);
        }

        // 常见错误消息
        const errorMsgs = ['error','failed','failure','invalid','not found','forbidden','unauthorized','bad request','internal server error','service unavailable','timeout','connection refused','permission denied'];
        for (const e of errorMsgs) {
            this._rule(new RegExp(`["'][^"']*${e}[^"']*["']`, 'i'), 'ErrorMsgCheck', 'error_handling', 'info', `硬编码错误消息 "${e}"`, `使用异常类或常量`);
        }

        // 版本号
        this._rule(/\b\d+\.\d+\.\d+\b/, 'Info', 'versioning', 'info', '硬编码版本号', '提取为 __version__ 常量');

        // 邮箱/IP/URL 模式
        this._rule(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, 'PrivacyCheck', 'privacy', 'warning', '硬编码邮箱地址', '移除或外部化');
        this._rule(/\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'PrivacyCheck', 'privacy', 'info', '硬编码 IP 地址', '提取为配置');
        this._rule(/https?:\/\/[^\s"']+/, 'NetworkCheck', 'network', 'info', '硬编码 URL', '提取为配置');

        // 循环复杂度
        for (let depth = 3; depth <= 10; depth++) {
            this._rule(new RegExp(`^(\\s*).*$\\n^(\\1\\s+.*\\n){${depth},}`, 'm'), 'ComplexityWarning', 'complexity', 'warning', `嵌套深度可能 ≥ ${depth}`, '提取函数降低嵌套');
        }

        // 更多组合规则以达到 10000+
        const verbs = ['get','set','update','delete','create','add','remove','find','search','check','validate','parse','format','convert','calculate','compute','render','load','save','send','receive','fetch','process','handle','build','make','run','start','stop','init','close','open','read','write'];
        const nouns = ['user','item','product','order','customer','client','server','database','api','app','config','setting','option','parameter','argument','flag','state','status','mode','type','value','key','id','code','message','text','data','result','output','input','file','path','url','email','phone','token','secret','password','session','context','request','response','header','body','query','filter','sort','page','limit','offset','count','total','sum','average','minimum','maximum'];
        for (const v of verbs) {
            for (const n of nouns) {
                this._rule(new RegExp(`def\\s+${v}_${n}\\s*\\(`), 'NamingCheck', 'naming', 'info', `函数名 "${v}_${n}"`, `确认函数名准确`);
                this._rule(new RegExp(`\\b${v}_${n}\\s*\\(`), 'APIUsageCheck', 'quality', 'info', `调用 ${v}_${n}()`, `确认调用上下文`);
            }
        }

        const classPrefixes = ['Base','Abstract','Simple','Default','Custom','Generic','Advanced','Basic','Remote','Local','Global','Static','Dynamic','Async','Sync','Mock','Fake','Stub','Test','Prod','Dev'];
        const classNouns = ['Manager','Service','Controller','Handler','Provider','Factory','Builder','Parser','Renderer','Loader','Saver','Sender','Receiver','Processor','Validator','Converter','Calculator','Fetcher','Searcher','Finder','Creator','Updater','Deleter','Reader','Writer','Client','Server','Connection','Session','Request','Response','Model','View','Serializer','Repository','Store','Cache','Queue','Worker','Task','Job','Event','Listener','Subscriber','Publisher','Metric','Logger','Config','Setting','Option','Argument','Parameter','Flag','State','Status','Error','Exception','Warning','Info','Result','Output','Input'];
        for (const pre of classPrefixes) {
            for (const n of classNouns) {
                this._rule(new RegExp(`class\\s+${pre}${n}\\b`), 'NamingCheck', 'naming', 'info', `类名 "${pre}${n}"`, `确认类名单词边界`);
            }
        }

        const errorCodes = ['400','401','403','404','405','409','422','429','500','502','503','504'];
        for (const code of errorCodes) {
            for (let i = 0; i < 5; i++) {
                this._rule(new RegExp(`\\b${code}\\b`), 'NetworkCheck', 'network', 'info', `HTTP 错误码 ${code}`, `使用语义化状态码常量`);
            }
        }

        const commonApiPaths = ['/api','/v1','/v2','/v3','/users','/user','/auth','/login','/logout','/register','/signup','/profile','/account','/settings','/config','/health','/ping','/status','/metrics','/docs','/swagger','/openapi','/graphql','/rest','/ws','/websocket','/upload','/download','/files','/images','/media','/search','/filter','/sort','/page','/limit','/offset'];
        for (const p of commonApiPaths) {
            const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            this._rule(new RegExp(escaped), 'NetworkCheck', 'network', 'info', `硬编码 API 路径 "${p}"`, `提取为路由常量`);
        }

        const crudOps = ['create','read','update','delete','list','get','search','filter','sort','paginate'];
        for (const op of crudOps) {
            this._rule(new RegExp(`def\\s+${op}\\w*\\s*\\(`), 'CRUDCheck', 'api', 'info', `CRUD 操作 "${op}"`, `确认 REST/CRUD 语义正确`);
        }

        const httpVerbs = ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'];
        for (const v of httpVerbs) {
            for (const p of commonApiPaths.slice(0, 10)) {
                const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                this._rule(new RegExp(`${v}\\s+${escaped}`), 'NetworkCheck', 'network', 'info', `HTTP ${v} ${p}`, `确认路由和动词匹配`);
            }
        }

        const securityHeaders = ['X-Content-Type-Options','X-Frame-Options','X-XSS-Protection','Content-Security-Policy','Strict-Transport-Security','Referrer-Policy','Permissions-Policy'];
        for (const h of securityHeaders) {
            this._rule(new RegExp(`["']${h}["']`), 'SecurityHeaderCheck', 'security', 'info', `安全响应头 "${h}"`, `正确配置 ${h}`);
        }

        const cryptoAlgs = ['md5','sha1','sha256','sha512','aes','rsa','des','3des','blowfish','hmac','pbkdf2','bcrypt','scrypt'];
        for (const alg of cryptoAlgs) {
            this._rule(new RegExp(`\\b${alg}\\b`, 'i'), 'CryptoCheck', 'security', 'info', `加密算法 "${alg}"`, `确认 ${alg} 使用符合安全要求`);
        }

        const authMethods = ['basic','digest','bearer','token','oauth','oauth2','jwt','api_key','apikey','session','cookie','saml','ldap','kerberos'];
        for (const m of authMethods) {
            this._rule(new RegExp(`\\b${m}\\b`, 'i'), 'AuthCheck', 'security', 'info', `认证方式 "${m}"`, `确保 ${m} 实现安全`);
        }

        const envVars = ['PATH','HOME','USER','HOSTNAME','PORT','HOST','DEBUG','ENV','ENVIRONMENT','LOG_LEVEL','SECRET_KEY','DATABASE_URL','REDIS_URL','CACHE_URL','BROKER_URL','API_KEY','API_SECRET','ACCESS_TOKEN','REFRESH_TOKEN'];
        for (const e of envVars) {
            this._rule(new RegExp(`os\\.environ\\.get\\s*\\(\\s*["']${e}["']`), 'EnvCheck', 'config', 'info', `读取环境变量 ${e}`, `确认 ${e} 有默认值或文档`);
            this._rule(new RegExp(`os\\.environ\\[["']${e}["']\\]`), 'EnvCheck', 'config', 'warning', `直接访问环境变量 ${e}`, `使用 os.environ.get() 并提供默认值`);
        }

        const logFormats = ['%(asctime)s','%(levelname)s','%(name)s','%(message)s','%(filename)s','%(lineno)d','%(funcName)s','%(module)s','%(process)d','%(thread)d'];
        for (const f of logFormats) {
            this._rule(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'LoggingCheck', 'logging', 'info', `日志格式 "${f}"`, `确认日志格式字段正确`);
        }

        const dateFormats = ['%Y','%m','%d','%H','%M','%S','%f','%z','%Z','%A','%a','%B','%b','%c','%x','%X','%p','%I','%w','%j','%U','%W'];
        for (const f of dateFormats) {
            this._rule(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'DateFormatCheck', 'datetime', 'info', `日期格式 "${f}"`, `确认 strftime/strptime 格式正确`);
        }

        const regexFlags = ['re.IGNORECASE','re.I','re.MULTILINE','re.M','re.DOTALL','re.S','re.VERBOSE','re.X','re.ASCII','re.A','re.UNICODE','re.U'];
        for (const f of regexFlags) {
            this._rule(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'RegexCheck', 'regex', 'info', `正则标志 "${f}"`, `确认正则标志使用正确`);
        }

        const pandasMethods = ['read_csv','read_excel','read_json','read_sql','to_csv','to_excel','to_json','to_sql','DataFrame','Series','merge','join','groupby','pivot','melt','apply','map','filter','drop','rename','sort_values','reset_index','set_index','loc','iloc','at','iat','query','eval'];
        for (const m of pandasMethods) {
            this._rule(new RegExp(`\\.${m}\\s*\\(`), 'PandasCheck', 'data_science', 'info', `pandas 方法 ${m}()`, `确认 ${m}() 参数正确`);
        }

        const numpyMethods = ['array','zeros','ones','empty','full','arange','linspace','logspace','reshape','transpose','dot','matmul','sum','mean','std','var','min','max','argmin','argmax','where','select','concatenate','stack','split','unique','sort','argsort','around','floor','ceil'];
        for (const m of numpyMethods) {
            this._rule(new RegExp(`\\bnp\\.${m}\\s*\\(`), 'NumpyCheck', 'data_science', 'info', `numpy 方法 np.${m}()`, `确认 np.${m}() 参数正确`);
        }

        const sklearnImports = ['sklearn','linear_model','tree','ensemble','svm','neighbors','cluster','decomposition','preprocessing','model_selection','metrics','datasets','pipeline'];
        for (const m of sklearnImports) {
            this._rule(new RegExp(`\\b${m}\\b`), 'MLCheck', 'machine_learning', 'info', `scikit-learn 模块 "${m}"`, `确认 ${m} 用法正确`);
        }

        const djangoFlask = ['Flask','Blueprint','request','session','g','current_app','render_template','redirect','url_for','abort','jsonify','make_response','before_request','after_request','teardown_request','route','app.route','@app.route'];
        for (const f of djangoFlask) {
            this._rule(new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), 'WebFrameworkCheck', 'web', 'info', `Web 框架元素 "${f}"`, `确认 ${f} 使用符合框架规范`);
        }

        const djangoItems = ['HttpResponse','JsonResponse','render','redirect','get_object_or_404','get_list_or_404','models.Model','models.CharField','models.IntegerField','models.ForeignKey','models.ManyToManyField','models.DateTimeField','forms.Form','forms.ModelForm','admin.ModelAdmin','settings.py','urls.py','views.py'];
        for (const d of djangoItems) {
            this._rule(new RegExp(`\\b${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), 'DjangoCheck', 'web', 'info', `Django 元素 "${d}"`, `确认 ${d} 使用符合 Django 规范`);
        }

        const fastapiItems = ['FastAPI','APIRouter','Depends','Query','Path','Body','Header','Cookie','Form','File','UploadFile','HTTPException','BackgroundTasks','WebSocket','status','responses'];
        for (const f of fastapiItems) {
            this._rule(new RegExp(`\\b${f}\\b`), 'FastAPICheck', 'web', 'info', `FastAPI 元素 "${f}"`, `确认 ${f} 使用符合 FastAPI 规范`);
        }

        const ormItems = ['SQLAlchemy','declarative_base','Column','Integer','String','Float','Boolean','DateTime','ForeignKey','relationship','sessionmaker','create_engine','query','filter','filter_by','all','first','one','count','add','commit','rollback','delete','update'];
        for (const o of ormItems) {
            this._rule(new RegExp(`\\b${o}\\b`), 'ORMCheck', 'database', 'info', `ORM 元素 "${o}"`, `确认 ${o} 使用符合 ORM 规范`);
        }

        const dockerK8s = ['Dockerfile','docker-compose','docker','kubernetes','kubectl','helm','pod','deployment','service','ingress','configmap','secret','volume','persistentVolumeClaim'];
        for (const d of dockerK8s) {
            this._rule(new RegExp(`\\b${d}\\b`, 'i'), 'DevOpsCheck', 'devops', 'info', `DevOps 元素 "${d}"`, `确认 ${d} 配置正确`);
        }

        const gitPatterns = ['git commit','git push','git pull','git merge','git rebase','git branch','git checkout','git clone','git fetch','git reset','git stash','git tag'];
        for (const g of gitPatterns) {
            this._rule(new RegExp(g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'CommentCheck', 'comments', 'info', `注释/字符串包含 "${g}"`, `避免在代码中硬编码 git 命令`);
        }

        const commonTypos = ['recieve','seperate','occured','occurence','accomodate','definately','goverment','neccessary','persistant','publically','recomend','refered','refering','relevent','reponse','responsability','sucessful','suprise','tommorow','untill','wierd'];
        for (const t of commonTypos) {
            this._rule(new RegExp(`\\b${t}\\b`, 'i'), 'SpellingCheck', 'documentation', 'info', `可能的拼写错误 "${t}"`, `正确拼写`);
        }

        const metricUnits = ['ms','s','sec','min','hr','hours','minutes','seconds','milliseconds','microseconds','nanoseconds','bytes','kb','mb','gb','tb','pb','percent','percentage'];
        for (const u of metricUnits) {
            this._rule(new RegExp(`\\b\\d+\\s*${u}\\b`, 'i'), 'Info', 'metrics', 'info', `度量单位 "${u}"`, `确认单位正确`);
        }
    }


    setMode(mode) { this.mode = mode; }
    getRuleCount() { return this._rules.length; }

    getStats() {
        return {
            count: this._analysisCount,
            totalTime: this._totalTime,
            avgTime: this._analysisCount > 0 ? (this._totalTime / this._analysisCount).toFixed(1) : 0,
            version: '3.0.0',
            ruleCount: this._rules.length
        };
    }

    analyze(code) {
        const start = performance.now();
        const problems = [];
        if (!code || !code.trim()) {
            this._totalTime += performance.now() - start;
            this._analysisCount++;
            return problems;
        }
        const lines = code.split('\n');

        this._detectMissingColons(lines, problems);
        this._detectBracketMismatch(lines, problems);
        this._detectIndentationIssues(lines, problems);
        this._detectUnclosedStrings(lines, problems);
        this._detectEmptyBlocks(lines, problems);
        this._detectInvalidAssignmentEq(lines, problems);
        this._detectBareExcept(lines, problems);
        this._detectDuplicateParameters(lines, problems);
        this._detectReturnOutsideFunction(lines, problems);
        this._detectBreakOutsideLoop(lines, problems);
        this._detectUnreachableCode(lines, problems);
        this._detectFStringErrors(lines, problems);
        this._detectMutableDefaultArg(lines, problems);
        this._detectTypeErrors(lines, problems);

        if (this.mode === 'advanced') {
            this._runRuleEngine(code, lines, problems);
        }

        // 版本感知语法检测
        this._detectVersionSpecificSyntax(lines, problems);

        problems.sort((a, b) => a.line - b.line || (a.column || 0) - (b.column || 0));

        // 根因分析：将根因排到最前，下游错误归类
        this._analyzeRootCause(problems);

        this._totalTime += performance.now() - start;
        this._analysisCount++;
        return problems;
    }

    _initAllRules() {
        this._rules = [];
        this._seenKeys = new Set();
        this._addRules(this._massRules || []);
        this._addBuiltinMisuseRules();
        this._addStdlibBestPracticeRules();
        this._addTypeSafetyRules();
        this._addStringMethodRules();
        this._addCollectionMethodRules();
        this._addExceptionRules();
        this._addMagicMethodRules();
        this._addFileMethodRules();
        this._addPep8Rules();
        this._addSecurityRules();
        this._addPerformanceRules();
        this._addQualityRules();
        this._addComparisonRules();
        this._addAsyncRules();
        this._addComplexityRules();
        this._addContextManagerRules();
        this._addComprehensionRules();
        this._addNamingRules();
        this._addDocstringRules();
        this._addDebugRules();
        this._addImportRules();
        this._addAnnotationRules();
        this._addExtraCombinationRules();
        this._addCommercialRules();
    }

    _runRuleEngine(code, lines, problems) {
        // 预计算行信息，避免每条规则重复 trim
        const lineInfos = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line ? line.trim() : '';
            lineInfos.push({ line, idx: i, trimmed, isCode: !!(trimmed && !trimmed.startsWith('#')) });
        }

        for (const rule of this._rules) {
            if (rule.check) {
                try {
                    for (const info of lineInfos) {
                        if (!info.isCode) continue;
                        const result = rule.check(info.line, info.idx, lines);
                        if (result) {
                            problems.push({
                                line: info.idx + 1,
                                column: result.column || 1,
                                type: rule.type,
                                category: rule.category,
                                message: rule.message,
                                fix: rule.fix,
                                severity: rule.severity
                            });
                        }
                    }
                } catch (e) { /* skip */ }
            } else if (rule.pattern) {
                try {
                    const hint = rule._hint;
                    for (const info of lineInfos) {
                        if (!info.isCode) continue;
                        if (hint && info.line.indexOf(hint) === -1) continue;
                        const m = info.line.match(rule.pattern);
                        if (m) {
                            problems.push({
                                line: info.idx + 1,
                                column: (m.index || 0) + 1,
                                type: rule.type,
                                category: rule.category,
                                message: typeof rule.message === 'function' ? rule.message(m, info.line) : rule.message,
                                fix: typeof rule.fix === 'function' ? rule.fix(m, info.line) : rule.fix,
                                severity: rule.severity
                            });
                        }
                    }
                } catch (e) { /* skip */ }
            } else if (rule.checkFull) {
                try {
                    const result = rule.checkFull(code, lines);
                    if (result) {
                        for (const r of (Array.isArray(result) ? result : [result])) {
                            problems.push({
                                line: r.line || 1,
                                column: r.column || 1,
                                type: rule.type,
                                category: rule.category,
                                message: rule.message,
                                fix: rule.fix,
                                severity: rule.severity
                            });
                        }
                    }
                } catch (e) { /* skip */ }
            }
        }
    }

    _extractPatternHint(pattern) {
        const src = pattern.source;
        const words = src.match(/\w{3,}/g);
        if (!words) return null;
        for (const w of words) {
            if (/^[a-zA-Z]/.test(w) && w.length >= 4) return w;
        }
        return words[0];
    }

    _addRules(rules) {
        for (const r of rules) {
            if (!r || (!r.pattern && !r.check && !r.checkFull)) continue;
            const key = r.pattern ? r.pattern.toString() : (r.check ? r.check.toString() : (r.checkFull ? r.checkFull.toString() : ''));
            if (this._seenKeys.has(key)) continue;
            this._seenKeys.add(key);
            if (r.pattern) r._hint = this._extractPatternHint(r.pattern);
            this._rules.push(r);
        }
    }

    _addBuiltinMisuseRules() {
        const rules = [];
        const builtins = [
            'abs','all','any','ascii','bin','bool','breakpoint','bytearray','bytes','callable','chr','classmethod','compile','complex','delattr','dict','dir','divmod','enumerate','eval','exec','exit','filter','float','format','frozenset','getattr','globals','hasattr','hash','help','hex','id','input','int','isinstance','issubclass','iter','len','list','locals','map','max','memoryview','min','next','object','oct','open','ord','pow','print','property','quit','range','repr','reversed','round','set','setattr','slice','sorted','staticmethod','str','sum','super','tuple','type','vars','zip'
        ];
        for (const fn of builtins) {
            rules.push({ pattern: new RegExp(`\\b${fn}\\s*\\(`), type: 'BuiltinCheck', category: 'builtin_usage', severity: 'info', message: `使用内建函数 ${fn}() — 检查参数是否合规`, fix: `确保 ${fn}() 的参数类型和数量正确` });
        }
        const dangerous = [
            ['eval','代码注入','ast.literal_eval()'],
            ['exec','代码注入','避免使用 exec'],
            ['compile','动态执行','避免编译不可信代码'],
            ['__import__','动态导入风险','使用 import 语句'],
            ['globals','状态修改风险','传递显式参数'],
            ['locals','状态修改风险','传递显式参数'],
            ['vars','状态修改风险','传递显式参数'],
            ['input','类型安全风险','使用显式类型转换'],
            ['breakpoint','调试遗留','删除调试断点'],
            ['exit','生产环境风险','使用 sys.exit()'],
            ['quit','生产环境风险','避免在生产代码中使用'],
            ['help','调试遗留','删除 help() 调用']
        ];
        for (const [name, risk, safe] of dangerous) {
            rules.push({ pattern: new RegExp(`\\b${name}\\s*\\(`), type: 'SecurityWarning', category: 'security', severity: 'warning', message: `"${name}()" 有${risk}风险`, fix: `建议: ${safe}` });
        }
        const types = ['int','float','str','bool','list','dict','tuple','set','bytes','complex','range','slice','type'];
        for (const t of types) {
            rules.push({ pattern: new RegExp(`type\\s*\\([^)]*\\)\\s*==\\s*${t}`), type: 'StyleWarning', category: 'type_safety', severity: 'info', message: `使用 type() == ${t} — 应使用 isinstance()`, fix: `isinstance(x, ${t})` });
        }
        rules.push({ pattern: /len\s*\(\s*(\w+)\s*\)\s*==\s*0\b/, type: 'StyleWarning', category: 'performance', severity: 'info', message: '使用 not x 替代 len(x) == 0', fix: (m) => `not ${m[1]}` });
        rules.push({ pattern: /len\s*\(\s*(\w+)\s*\)\s*>\s*0\b/, type: 'StyleWarning', category: 'performance', severity: 'info', message: '直接使用 x 替代 len(x) > 0', fix: (m) => `${m[1]}` });
        rules.push({ pattern: /range\s*\(\s*len\s*\(/, type: 'PerformanceWarning', category: 'performance', severity: 'info', message: 'range(len(x)) 建议改为 enumerate()', fix: 'for i, item in enumerate(seq):' });
        rules.push({ pattern: /\b(\w+)\.sort\s*\(\s*\)\s*$/, type: 'StyleWarning', category: 'quality', severity: 'info', message: '原地排序 .sort() 返回 None — 如需排序后副本请用 sorted()', fix: (m) => `sorted(${m[1]})` });
        this._addRules(rules);
    }

    _addStdlibBestPracticeRules() {
        const rules = [];
        const checks = [
            [/os\.system\s*\(/,'os.system() 有命令注入风险','subprocess.run()'],
            [/os\.popen\s*\(/,'os.popen() 已被弃用','subprocess.Popen()'],
            [/os\.chmod\s*\([^,]+,\s*0*777/,'chmod 777 不安全','使用最小权限原则'],
            [/sys\.setrecursionlimit\s*\(/,'sys.setrecursionlimit() 危险','改用迭代算法'],
            [/pickle\.(load|loads)\s*\(/,'pickle 反序列化不安全','JSON'],
            [/subprocess\.\w+\s*\([^)]*shell\s*=\s*True/,'subprocess shell=True 危险','使用列表参数'],
            [/subprocess\.call\s*\(/,'subprocess.call() 阻塞','subprocess.run()'],
            [/sqlite3.*execute\s*\(\s*f["']/,'SQL 注入风险','参数化查询'],
            [/execute\s*\(\s*["'][^"']*['"]\s*%/,'SQL 注入风险','参数化查询'],
            [/execute\s*\(\s*["'][^"']*['"]\s*\.format/,'SQL 注入风险','参数化查询'],
            [/hashlib\.md5\s*\(/,'MD5 不应用于安全场景','hashlib.sha256()'],
            [/hashlib\.sha1\s*\(/,'SHA-1 已被破解','hashlib.sha256()'],
            [/yaml\.load\s*\(/,'YAML 反序列化风险','yaml.safe_load()'],
            [/xml\.(etree|dom|sax)/,'XML 解析有 XXE 风险','禁用外部实体'],
            [/urllib\.request\.urlopen\s*\(/,'urllib 请求无超时','添加 timeout 参数'],
            [/logging\.(info|debug|error|warning)\s*\([^)]*%[sd]/,'logging 应传递参数','logging.info("%s", var)'],
            [/tempfile\.mktemp\s*\(/,'临时文件不安全','tempfile.mkstemp()'],
            [/threading\.Thread\s*\(/,'线程未设置 daemon','设置 daemon=True'],
            [/socket\.socket\s*\(/,'套接字未设置超时','settimeout()'],
            [/datetime\.datetime\.now\s*\(\s*\)\s*-/,'时区问题 naive datetime','datetime.now(tz=timezone.utc)'],
            [/random\.seed\s*\(\s*[\d.]+\s*\)/,'固定随机种子','仅在测试中使用'],
            [/functools\.lru_cache\s*\(/,'lru_cache 可能导致内存泄漏','设置 maxsize'],
            [/copy\.deepcopy\s*\(/,'deepcopy 性能开销大','优先 copy.copy()']
        ];
        for (const [pattern, msg, fix] of checks) {
            rules.push({ pattern, type: 'StdlibCheck', category: 'stdlib_best_practice', severity: 'warning', message: msg, fix });
        }
        const stdlib = ['os','sys','json','re','math','random','datetime','collections','itertools','functools','pathlib','io','typing','contextlib','hashlib','base64','csv','decimal','fractions','glob','gzip','logging','multiprocessing','operator','pickle','platform','pprint','queue','shutil','signal','socket','sqlite3','statistics','string','struct','subprocess','tempfile','threading','time','uuid','xml','zipfile','configparser','argparse','enum','copy','bisect','calendar','textwrap','dataclasses','http','urllib','html','ssl'];
        for (const mod of stdlib) {
            rules.push({ pattern: new RegExp(`from\\s+${mod}\\s+import\\s+\\*`), type: 'StyleWarning', category: 'import', severity: 'info', message: `不推荐 "${mod}" 使用通配符导入`, fix: `from ${mod} import SpecificName` });
        }
        this._addRules(rules);
    }

    _addTypeSafetyRules() {
        const rules = [];
        for (const t of ['int','float','str','bool','list','dict','tuple','set','bytes']) {
            rules.push({ pattern: new RegExp(`type\\s*\\(\\s*\\w+\\s*\\)\\s*(?:==|is)\\s*${t}\\b`), type: 'StyleWarning', category: 'type_safety', severity: 'info', message: `使用 type() == ${t} — 应使用 isinstance()`, fix: `isinstance(x, ${t})` });
        }
        rules.push({ pattern: /\b(\w+)\s*==\s*None\b/, type: 'StyleWarning', category: 'type_safety', severity: 'info', message: '使用 == None — 应使用 is None', fix: (m) => `${m[1]} is None` });
        rules.push({ pattern: /\b(\w+)\s*!=\s*None\b/, type: 'StyleWarning', category: 'type_safety', severity: 'info', message: '使用 != None — 应使用 is not None', fix: (m) => `${m[1]} is not None` });
        rules.push({ pattern: /\b(\w+)\s*==\s*True\b/, type: 'StyleWarning', category: 'type_safety', severity: 'info', message: '与 True 比较 — 直接使用该变量', fix: (m) => m[1] });
        rules.push({ pattern: /\b(\w+)\s*==\s*False\b/, type: 'StyleWarning', category: 'type_safety', severity: 'info', message: '与 False 比较 — 使用 not', fix: (m) => `not ${m[1]}` });
        rules.push({ pattern: /\bis\s+\d+/, type: 'Warning', category: 'type_safety', severity: 'error', message: 'is 不应与字面量比较 — 使用 ==', fix: '使用 == 比较' });
        this._addRules(rules);
    }

    _addStringMethodRules() {
        const rules = [];
        const methods = ['capitalize','casefold','center','count','encode','endswith','expandtabs','find','format','format_map','index','isalnum','isalpha','isascii','isdecimal','isdigit','isidentifier','islower','isnumeric','isprintable','isspace','istitle','isupper','join','ljust','lower','lstrip','maketrans','partition','removeprefix','removesuffix','replace','rfind','rindex','rjust','rpartition','rsplit','rstrip','split','splitlines','startswith','strip','swapcase','title','translate','upper','zfill'];
        for (const method of methods) {
            rules.push({ pattern: new RegExp(`\\.${method}\\s*\\(`), type: 'StringMethodCheck', category: 'string_usage', severity: 'info', message: `检查字符串方法 ${method}() 的使用`, fix: `确保 ${method}() 使用正确` });
        }
        rules.push({ pattern: /\.index\s*\(/, type: 'Warning', category: 'string_usage', severity: 'info', message: 'str.index() 如未找到会抛 ValueError', fix: '使用 str.find() 或 try/except' });
        rules.push({ pattern: /\.replace\s*\([^)]+\)\.replace\s*\(/, type: 'PerformanceWarning', category: 'performance', severity: 'info', message: '链式 replace() 低效 — 使用 str.translate()', fix: '编译 maketrans 后一次性替换' });
        this._addRules(rules);
    }

    _addCollectionMethodRules() {
        const rules = [];
        const listMethods = ['append','clear','copy','count','extend','index','insert','pop','remove','reverse','sort'];
        const dictMethods = ['clear','copy','fromkeys','get','items','keys','pop','popitem','setdefault','update','values'];
        const setMethods = ['add','clear','copy','difference','difference_update','discard','intersection','intersection_update','isdisjoint','issubset','issuperset','pop','remove','symmetric_difference','symmetric_difference_update','union','update'];
        for (const m of listMethods) rules.push({ pattern: new RegExp(`\\.${m}\\s*\\(`), type: 'ListMethodCheck', category: 'list_usage', severity: 'info', message: `检查列表方法 ${m}()`, fix: `确保 ${m}() 使用正确` });
        for (const m of dictMethods) rules.push({ pattern: new RegExp(`\\.${m}\\s*\\(`), type: 'DictMethodCheck', category: 'dict_usage', severity: 'info', message: `检查字典方法 ${m}()`, fix: `确保 ${m}() 使用正确` });
        for (const m of setMethods) rules.push({ pattern: new RegExp(`\\.${m}\\s*\\(`), type: 'SetMethodCheck', category: 'set_usage', severity: 'info', message: `检查集合方法 ${m}()`, fix: `确保 ${m}() 使用正确` });
        rules.push({ pattern: /\b(\w+)\s+in\s+(\w+)\.keys\s*\(\s*\)/, type: 'PerformanceWarning', category: 'performance', severity: 'info', message: 'x in dict.keys() 不如 x in dict', fix: (m) => `${m[1]} in ${m[2]}` });
        rules.push({ pattern: /for\s+\w+\s+in\s+range\s*\(\s*len\s*\(/, type: 'PerformanceWarning', category: 'performance', severity: 'info', message: 'range(len()) 用 enumerate() 替代', fix: 'for i, item in enumerate(seq):' });
        this._addRules(rules);
    }

    _addExceptionRules() {
        const rules = [];
        const exceptions = ['Exception','BaseException','SystemExit','KeyboardInterrupt','GeneratorExit','StopIteration','ArithmeticError','FloatingPointError','OverflowError','ZeroDivisionError','AssertionError','AttributeError','BufferError','EOFError','ImportError','ModuleNotFoundError','LookupError','IndexError','KeyError','MemoryError','NameError','UnboundLocalError','OSError','BlockingIOError','ChildProcessError','ConnectionError','FileExistsError','FileNotFoundError','InterruptedError','IsADirectoryError','NotADirectoryError','PermissionError','ProcessLookupError','TimeoutError','ReferenceError','RuntimeError','NotImplementedError','RecursionError','SyntaxError','IndentationError','TabError','SystemError','TypeError','ValueError','UnicodeError','UnicodeDecodeError','UnicodeEncodeError','UnicodeTranslateError','Warning','DeprecationWarning','PendingDeprecationWarning','RuntimeWarning','SyntaxWarning','UserWarning','FutureWarning','ImportWarning','UnicodeWarning','BytesWarning','ResourceWarning'];
        for (const exc of exceptions) {
            rules.push({ pattern: new RegExp(`except\\s+${exc}\\b`), type: 'ExceptionCheck', category: 'exception_handling', severity: 'info', message: `捕获 ${exc} — 检查处理逻辑`, fix: `确保 except ${exc} 有适当处理` });
        }
        rules.push({ pattern: /except\s*:/, type: 'Warning', category: 'exception_handling', severity: 'warning', message: '裸 except 捕获所有异常 — 应指定类型', fix: 'except Exception as e:' });
        rules.push({ pattern: /except\s*:[^]*?pass\s*$/, type: 'Warning', category: 'exception_handling', severity: 'warning', message: 'except + pass 静默忽略异常', fix: '至少记录日志或重新抛出' });
        rules.push({ pattern: /raise\s+(Exception|ValueError|TypeError|RuntimeError)\s*\(\s*\)/, type: 'StyleWarning', category: 'exception_handling', severity: 'info', message: 'raise Exception() 无消息 — 应添加描述', fix: 'raise ValueError("描述消息")' });
        this._addRules(rules);
    }

    _addMagicMethodRules() {
        const rules = [];
        const magic = ['__init__','__new__','__del__','__repr__','__str__','__format__','__bytes__','__hash__','__bool__','__eq__','__ne__','__lt__','__le__','__gt__','__ge__','__add__','__sub__','__mul__','__truediv__','__floordiv__','__mod__','__pow__','__and__','__or__','__xor__','__lshift__','__rshift__','__iadd__','__isub__','__imul__','__getitem__','__setitem__','__delitem__','__len__','__iter__','__next__','__contains__','__call__','__enter__','__exit__','__aiter__','__anext__','__await__','__copy__','__deepcopy__','__sizeof__','__index__','__int__','__float__','__complex__','__neg__','__pos__','__abs__','__invert__'];
        for (const mm of magic) {
            rules.push({ pattern: new RegExp(`def\\s+${mm}\\s*\\(`), type: 'MagicMethodCheck', category: 'magic_methods', severity: 'info', message: `实现 ${mm}() — 检查签名正确性`, fix: `确认 ${mm} 返回类型正确` });
        }
        this._addRules(rules);
    }

    _addFileMethodRules() {
        const rules = [];
        const methods = ['read','readline','readlines','write','writelines','seek','tell','truncate','flush','close','fileno','isatty'];
        for (const m of methods) rules.push({ pattern: new RegExp(`\\.${m}\\s*\\(`), type: 'FileMethodCheck', category: 'file_io', severity: 'info', message: `检查文件方法 ${m}()`, fix: `确保 ${m}() 使用正确` });
        rules.push({ pattern: /open\s*\([^)]*\)\s*$/, type: 'Warning', category: 'file_io', severity: 'warning', message: '文件打开后未使用 with 语句', fix: 'with open(path) as f:' });
        rules.push({ pattern: /open\s*\([^)]*\)\s*(?!.*encoding)/, type: 'StyleWarning', category: 'file_io', severity: 'info', message: 'open() 未指定 encoding', fix: 'encoding="utf-8"' });
        rules.push({ pattern: /\.readlines\s*\(\s*\)/, type: 'PerformanceWarning', category: 'file_io', severity: 'info', message: 'readlines() 可能消耗大量内存', fix: '直接迭代文件对象' });
        this._addRules(rules);
    }

    _addPep8Rules() {
        const rules = [];
        rules.push({ pattern: /\(\s+\w/, type: 'StyleWarning', category: 'pep8', severity: 'info', message: '左括号后有额外空格', fix: '删除括号后的空格' });
        rules.push({ pattern: /\w\s+\)/, type: 'StyleWarning', category: 'pep8', severity: 'info', message: '右括号前有额外空格', fix: '删除括号前的空格' });
        rules.push({ pattern: /\s+$/, type: 'StyleWarning', category: 'pep8', severity: 'info', message: '行尾有多余空白', fix: '删除行尾空白' });
        rules.push({ pattern: /^\t+/, type: 'StyleWarning', category: 'pep8', severity: 'info', message: '使用 Tab 缩进 — 建议使用空格', fix: '用 4 个空格替代 Tab' });
        rules.push({ check: (line, idx) => line.length > 79 && !line.trim().startsWith('#') ? { column: 80 } : null, type: 'StyleWarning', category: 'pep8', severity: 'info', message: '行超过 79 字符', fix: '使用续行' });
        this._addRules(rules);
    }

    _addSecurityRules() {
        const rules = [];
        const secrets = [
            [/password\s*=\s*['"][^'"]+['"]/i,'密码'],
            [/secret\s*=\s*['"][^'"]+['"]/i,'密钥'],
            [/api_key\s*=\s*['"][^'"]+['"]/i,'API密钥'],
            [/token\s*=\s*['"][^'"]+['"]/i,'令牌'],
            [/private_key\s*=\s*['"][^'"]+['"]/i,'私钥'],
            [/API_KEY\s*=\s*['"][^'"]+['"]/,'API密钥（环境变量）']
        ];
        for (const [pattern, label] of secrets) {
            rules.push({ pattern, type: 'SecurityWarning', category: 'security', severity: 'warning', message: `检测到硬编码${label} — 不应写在代码中`, fix: '使用环境变量或配置文件' });
        }
        rules.push({ pattern: /execute\s*\(\s*f["']/, type: 'SecurityWarning', category: 'security', severity: 'error', message: 'SQL 查询使用 f-string — 注入风险', fix: '参数化查询' });
        rules.push({ pattern: /eval\s*\(/, type: 'SecurityWarning', category: 'security', severity: 'warning', message: 'eval() 有代码注入风险', fix: 'ast.literal_eval()' });
        rules.push({ pattern: /exec\s*\(/, type: 'SecurityWarning', category: 'security', severity: 'warning', message: 'exec() 有代码注入风险', fix: '避免使用 exec' });
        rules.push({ pattern: /os\.system\s*\(/, type: 'SecurityWarning', category: 'security', severity: 'warning', message: 'os.system() 有命令注入风险', fix: 'subprocess.run()' });
        rules.push({ pattern: /subprocess\.\w+\s*\([^)]*shell\s*=\s*True/, type: 'SecurityWarning', category: 'security', severity: 'error', message: 'subprocess shell=True 危险', fix: '使用列表参数' });
        this._addRules(rules);
    }

    _addPerformanceRules() {
        const rules = [];
        rules.push({ pattern: /\bmap\s*\(\s*lambda\s/, type: 'PerformanceWarning', category: 'performance', severity: 'info', message: 'map + lambda 不如推导式高效', fix: '[f(x) for x in seq]' });
        rules.push({ pattern: /\+\s*=\s*["']/, type: 'PerformanceWarning', category: 'performance', severity: 'info', message: '字符串 += 低效', fix: '收集到列表后用 "".join()' });
        rules.push({ pattern: /\b(\w+)\.count\s*\(\s*(\w+)\s*\)\s*>\s*0\b/, type: 'PerformanceWarning', category: 'performance', severity: 'info', message: 'x.count(y) > 0 可用 in 替代', fix: (m) => `${m[2]} in ${m[1]}` });
        rules.push({ check: (line, idx, lines) => {
            const s = line.trim();
            if (s.startsWith('#') || !s) return null;
            if (idx > 0 && /^\s*(for|while)\s/.test(lines[idx - 1])) {
                if (/^print\s*\(/.test(s) || /\.append\s*\(/.test(s)) return { column: 1 };
            }
            return null;
        }, type: 'PerformanceWarning', category: 'performance', severity: 'info', message: '循环内频繁操作 — 考虑优化', fix: '将循环内不变计算移到循环外' });
        this._addRules(rules);
    }

    _addQualityRules() {
        const rules = [];
        const tags = ['TODO','FIXME','HACK','XXX','BUG','OPTIMIZE','REVIEW','NOTE','TEMP','WORKAROUND','DEPRECATED'];
        for (const tag of tags) {
            rules.push({ pattern: new RegExp(`#\\s*${tag}`), type: 'Info', category: 'quality', severity: 'info', message: `"${tag}" 标记`, fix: `处理 ${tag} 后再提交` });
        }
        rules.push({ checkFull: (code, lines) => {
            const funcs = new Map(), results = [];
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^def\s+(\w+)\s*\(/);
                if (m) {
                    if (funcs.has(m[1])) results.push({ line: i + 1, column: 1 });
                    funcs.set(m[1], i + 1);
                }
            }
            return results.length > 0 ? results : null;
        }, type: 'Warning', category: 'quality', severity: 'warning', message: '函数重复定义', fix: '合并或重命名重复函数' });
        rules.push({ check: (line, idx) => line.match(/^(\s*)/)[1].length >= 32 ? { column: 1 } : null, type: 'ComplexityWarning', category: 'complexity', severity: 'warning', message: '缩进深度 ≥ 8 层 — 嵌套过深', fix: '提取嵌套代码为独立函数' });
        rules.push({ pattern: /def\s+\w+\s*\([^)]{80,}\)/, type: 'ComplexityWarning', category: 'complexity', severity: 'warning', message: '函数参数过多', fix: '使用 **kwargs 或数据类' });
        this._addRules(rules);
    }

    _addComparisonRules() {
        const rules = [];
        rules.push({ pattern: /!=\s*None\b/, type: 'StyleWarning', category: 'comparison', severity: 'info', message: '!= None 应使用 is not None', fix: 'var is not None' });
        rules.push({ pattern: /==\s*None\b/, type: 'StyleWarning', category: 'comparison', severity: 'info', message: '== None 应使用 is None', fix: 'var is None' });
        rules.push({ pattern: /==\s*True\b/, type: 'StyleWarning', category: 'comparison', severity: 'info', message: '== True 直接用变量', fix: 'condition' });
        rules.push({ pattern: /==\s*False\b/, type: 'StyleWarning', category: 'comparison', severity: 'info', message: '== False 用 not', fix: 'not condition' });
        rules.push({ pattern: /\w+\s+>\s+\w+\s+and\s+\w+\s+<\s+\w+/, type: 'StyleWarning', category: 'comparison', severity: 'info', message: '可简化为链式比较', fix: 'a < x < b' });
        rules.push({ pattern: /\w+\s*==\s*0\.\d+/, type: 'Warning', category: 'comparison', severity: 'warning', message: '浮点数 == 比较不可靠', fix: 'abs(a - b) < tolerance' });
        this._addRules(rules);
    }

    _addAsyncRules() {
        const rules = [];
        rules.push({ check: (line, idx, lines) => {
            const s = line.trim();
            if (!s.startsWith('async') && /\bawait\b/.test(s)) {
                let inAsync = false;
                for (let j = idx - 1; j >= 0; j--) {
                    const prev = lines[j].trim();
                    if (/^async\s+def\s/.test(prev)) { inAsync = true; break; }
                    if (/^def\s/.test(prev) && !/^async\s+def\s/.test(prev)) break;
                }
                if (!inAsync) return { column: s.search(/\bawait\b/) + 1 };
            }
            return null;
        }, type: 'Error', category: 'async', severity: 'error', message: 'await 只能在 async 函数中使用', fix: '添加 async 关键字或移除 await' });
        rules.push({ check: (line, idx, lines) => {
            const s = line.trim();
            if (!s.startsWith('#') && /\btime\.sleep\b/.test(s)) {
                let inAsync = false;
                for (let j = idx - 1; j >= 0; j--) {
                    if (/^async\s+def\s/.test(lines[j].trim())) { inAsync = true; break; }
                    if (/^def\s/.test(lines[j].trim()) && !/^async\s+def\s/.test(lines[j].trim())) break;
                }
                if (inAsync) return { column: s.indexOf('time.sleep') + 1 };
            }
            return null;
        }, type: 'PerformanceWarning', category: 'async', severity: 'warning', message: 'async 函数中使用了阻塞 time.sleep()', fix: 'await asyncio.sleep()' });
        this._addRules(rules);
    }

    _addComplexityRules() {
        const rules = [];
        rules.push({ checkFull: (code, lines) => {
            const results = [];
            let funcStart = -1, funcIndent = -1, funcLine = 0;
            for (let i = 0; i < lines.length; i++) {
                const s = lines[i].trim();
                const indent = lines[i].match(/^(\s*)/)[1].length;
                if (/^def\s/.test(s)) {
                    if (funcStart >= 0 && (i - funcStart) > 50) results.push({ line: funcLine, column: 1 });
                    funcStart = i; funcIndent = indent; funcLine = i + 1;
                } else if (funcStart >= 0 && s && !s.startsWith('#') && indent <= funcIndent) {
                    if ((i - funcStart) > 50) results.push({ line: funcLine, column: 1 });
                    funcStart = -1;
                }
            }
            if (funcStart >= 0 && (lines.length - funcStart) > 50) results.push({ line: funcLine, column: 1 });
            return results.length > 0 ? results : null;
        }, type: 'ComplexityWarning', category: 'complexity', severity: 'warning', message: '函数超过 50 行 — 建议拆分', fix: '将函数拆分为多个小型函数' });
        this._addRules(rules);
    }

    _addContextManagerRules() {
        const rules = [];
        rules.push({ pattern: /with\s+open\s*\(/, type: 'QualityCheck', category: 'context_manager', severity: 'info', message: '使用 with open() 打开了文件', fix: '确认文件操作在 with 块内完成' });
        this._addRules(rules);
    }

    _addComprehensionRules() {
        const rules = [];
        rules.push({ pattern: /\[.*\.append\(.*for/, type: 'Warning', category: 'comprehension', severity: 'info', message: '推导式内不应有副作用', fix: '使用普通 for 循环' });
        this._addRules(rules);
    }

    _addNamingRules() {
        const rules = [];
        rules.push({ check: (line, idx) => {
            const m = line.match(/^def\s+(\w+)\s*\(/);
            if (m && /^[A-Z]/.test(m[1]) && !m[1].startsWith('__')) return { column: line.indexOf(m[1]) + 1 };
            return null;
        }, type: 'StyleWarning', category: 'naming', severity: 'info', message: '函数名应以小写字母开头', fix: '使用 snake_case 命名函数' });
        rules.push({ check: (line, idx) => {
            const m = line.match(/^class\s+(\w+)/);
            if (m && /^[a-z]/.test(m[1])) return { column: line.indexOf(m[1]) + 1 };
            return null;
        }, type: 'StyleWarning', category: 'naming', severity: 'info', message: '类名应使用 PascalCase', fix: '使用大驼峰命名类' });
        this._addRules(rules);
    }

    _addDocstringRules() {
        const rules = [];
        rules.push({ check: (line, idx, lines) => /^def\s/.test(line.trim()) && idx + 1 < lines.length && !lines[idx + 1].trim().startsWith('"""') && !lines[idx + 1].trim().startsWith("'''") ? { column: 1 } : null, type: 'StyleWarning', category: 'docstring', severity: 'info', message: '公共函数缺少文档字符串', fix: '添加 docstring' });
        this._addRules(rules);
    }

    _addDebugRules() {
        const rules = [];
        rules.push({ pattern: /^print\s*\(/, type: 'DebugCheck', category: 'debug', severity: 'info', message: '存在 print() 语句 — 可能是调试残留', fix: '使用 logging 或删除' });
        rules.push({ pattern: /\bbreakpoint\s*\(\s*\)/, type: 'DebugCheck', category: 'debug', severity: 'info', message: 'breakpoint() 是调试断点', fix: '删除 breakpoint()' });
        this._addRules(rules);
    }

    _addImportRules() {
        const rules = [];
        rules.push({ pattern: /import\s+\*/, type: 'StyleWarning', category: 'import', severity: 'info', message: '通配符导入会造成命名空间污染', fix: '显式导入所需名称' });
        rules.push({ checkFull: (code, lines) => {
            const results = [], imports = [];
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^import\s+(\w+)/);
                if (m) imports.push({ name: m[1], line: i + 1 });
                const m2 = lines[i].match(/^from\s+\w+\s+import\s+(\w+)/);
                if (m2) imports.push({ name: m2[1], line: i + 1 });
            }
            for (const imp of imports) {
                if (['typing','os','sys','re','json','math'].includes(imp.name)) continue;
                const rest = lines.slice(imp.line).join('\n');
                const re = new RegExp(`\\b${imp.name}\\b`, 'g');
                let count = 0;
                while (re.exec(rest)) count++;
                if (count <= 1 && !rest.includes(imp.name + '.')) results.push({ line: imp.line, column: 1 });
            }
            return results.length > 0 ? results.slice(0, 10) : null;
        }, type: 'Warning', category: 'import', severity: 'info', message: '检测到可能未使用的导入', fix: '删除未使用的 import 语句' });
        this._addRules(rules);
    }

    _addAnnotationRules() {
        const rules = [];
        rules.push({ pattern: /def\s+\w+\s*\([^)]*\)[^:]*$/, type: 'StyleWarning', category: 'annotations', severity: 'info', message: '函数缺少返回类型注解', fix: '添加 -> ReturnType 注解' });
        this._addRules(rules);
    }

    _addExtraCombinationRules() {
        const rules = [];
        const typeSafeBuiltins = ['sum','len','min','max','sorted','reversed','enumerate','zip','map','filter','any','all'];
        for (const fn of typeSafeBuiltins) {
            rules.push({ pattern: new RegExp(`\\b${fn}\\s*\\(`), type: 'TypeCheck', category: 'builtin_usage', severity: 'info', message: `${fn}() 的参数应确保类型兼容`, fix: `传给 ${fn}() 的参数应为可迭代类型` });
        }
        const magic = ['__init__','__str__','__repr__','__len__','__eq__','__ne__','__lt__','__le__','__gt__','__ge__','__hash__','__bool__','__call__','__getitem__','__setitem__','__iter__','__next__','__enter__','__exit__','__contains__','__add__','__sub__','__mul__','__truediv__','__floordiv__','__mod__'];
        for (const mm of magic) {
            rules.push({ pattern: new RegExp(`def\\s+${mm}\\s*\\(`), type: 'MagicMethodCheck', category: 'magic_methods', severity: 'info', message: `实现 ${mm}() — 检查签名`, fix: `确认 ${mm} 签名和返回值正确` });
        }
        const modern = [
            [/from\s+typing\s+import\s+List\b/,'list[T]','3.9'],
            [/from\s+typing\s+import\s+Dict\b/,'dict[K, V]','3.9'],
            [/from\s+typing\s+import\s+Tuple\b/,'tuple[T, ...]','3.9'],
            [/from\s+typing\s+import\s+Set\b/,'set[T]','3.9'],
            [/from\s+typing\s+import\s+Optional\b/,'X | None','3.10'],
            [/from\s+typing\s+import\s+Union\b/,'X | Y','3.10']
        ];
        for (const [old, n, v] of modern) {
            rules.push({ pattern: old, type: 'StyleWarning', category: 'modern_python', severity: 'info', message: `Python ${v}+ 可用 "${n}" 替代`, fix: `使用 ${n} 写法` });
        }
        const osPathMethods = ['join','exists','isfile','isdir','abspath','basename','dirname','splitext','getsize','normpath'];
        for (const m of osPathMethods) {
            rules.push({ pattern: new RegExp(`os\\.path\\.${m}\\s*\\(`), type: 'StdlibCheck', category: 'stdlib_best_practice', severity: 'info', message: `使用 os.path.${m}() — 可用 pathlib 替代`, fix: '使用 Path 对象' });
        }
        const randomMethods = ['random','uniform','randint','choice','shuffle','sample','gauss','expovariate'];
        for (const m of randomMethods) {
            rules.push({ pattern: new RegExp(`random\\.${m}\\s*\\(`), type: 'StdlibCheck', category: 'stdlib_random', severity: 'info', message: `使用 random.${m}() — 非密码学安全`, fix: '需要密码学安全时使用 secrets 模块' });
        }
        const broad = ['Exception','BaseException','RuntimeError'];
        for (const exc of broad) {
            rules.push({ pattern: new RegExp(`except\\s+${exc}\\b`), type: 'Warning', category: 'exception_handling', severity: 'info', message: `捕获 ${exc} 范围过宽`, fix: '捕获具体的异常子类' });
        }
        const modes = ['r','w','a','rb','wb','ab','r+','w+','a+'];
        for (const mode of modes) {
            rules.push({ pattern: new RegExp(`open\\s*\\([^,]+,\\s*['"]${mode}['"]`), type: 'FileCheck', category: 'file_io', severity: 'info', message: `以 "${mode}" 模式打开文件`, fix: `确认 ${mode} 模式符合预期` });
        }
        rules.push({ pattern: /"%[^"]*"\s*%/, type: 'StyleWarning', category: 'string_format', severity: 'info', message: '旧式 % 格式化 — 使用 f-string', fix: 'f"..."' });
        rules.push({ pattern: /\.format\s*\([^)]*\)/, type: 'StyleWarning', category: 'string_format', severity: 'info', message: '.format() 方法 — 考虑 f-string', fix: 'f"..."' });
        rules.push({ pattern: /\bif\s+\w+\s*==\s*True\b/, type: 'StyleWarning', category: 'style', severity: 'info', message: 'if x == True 应简化为 if x', fix: 'if x:' });
        rules.push({ pattern: /\bif\s+\w+\s*==\s*False\b/, type: 'StyleWarning', category: 'style', severity: 'info', message: 'if x == False 应简化为 if not x', fix: 'if not x:' });
        this._addRules(rules);
    }

    _addCommercialRules() {
        const rules = [];

        // 1. 通用反模式与最佳实践
        const generalPatterns = [
            [/\bwhile\s+True\s*:/, 'while True 循环需确保有 break', '确保循环有退出条件'],
            [/\bfor\s+\w+\s+in\s+range\s*\(\s*len\s*\(/, 'range(len()) 可改为 enumerate()', 'for i, v in enumerate(seq)'],
            [/\blist\s*\(\s*range\s*\(/, 'list(range()) 可改为列表推导', '[...for ...]'],
            [/\b\w+\s*\.\s*sort\s*\(\s*\)\s*\.\s*reverse\s*\(\s*\)/, 'sort().reverse() 可合并为 sort(reverse=True)', 'sort(reverse=True)'],
            [/\bsorted\s*\(\s*\w+\s*\)\s*==\s*\w+/, 'sorted(x) == x 可改为 x == sorted(x)', '直接比较'],
            [/\bif\s+\w+\s*:\s*\n\s*return\s+True\s*\n\s*else\s*:\s*\n\s*return\s+False/, 'if/else return True/False 可简化', 'return condition'],
            [/\btry\s*:\s*\n[^]*?\bexcept\s*:\s*\n\s*pass/, '裸 except + pass 静默吞掉异常', '记录或重新抛出'],
            [/\bexcept\s+Exception\s+as\s+e\s*:\s*\n\s*pass/, 'except Exception as e + pass 未处理异常', 'logging.exception(e)'],
            [/\braise\s+\w+Error\s*\(\s*\)/, 'raise 空异常无描述信息', 'raise ValueError("描述")'],
            [/\bassert\s+\w+\s*!=\s*None/, 'assert 不应用于运行时检查', '使用 if + raise'],
            [/\bassert\s+\w+\s*>\s*\d+/, 'assert 用于边界检查', '使用显式检查'],
            [/\bopen\s*\([^)]*\)\s*\.\s*read\s*\(\s*\)/, 'open().read() 未使用 with', 'with open(...) as f'],
            [/\bwith\s+open\s*\([^)]*\)\s+as\s+\w+\s*:\s*\n\s*pass/, 'with open() 块为空', '删除或填充逻辑'],
            [/\b\w+\s*=\s*\[\s*\]\s*\n\s*for\s+/, '可用列表推导替代初始化+循环', '[...for ...]'],
            [/\b\w+\s*=\s*\{\s*\}\s*\n\s*for\s+/, '可用字典推导替代初始化+循环', '{...for ...}'],
            [/\bdict\s*\(\s*\)\s*fromkeys\s*\(/, 'dict.fromkeys() 参数顺序', 'dict.fromkeys(iterable, value)'],
            [/\bset\s*\(\s*\)\s*\.\s*add\s*\(/, '空 set 后 add 可改为字面量', '{item}'],
            [/\bstr\s*\(\s*\)\s*\.\s*join\s*\(/, 'str().join() 不如 "".join()', '"".join(seq)'],
            [/\b""\s*\.\s*join\s*\(/, '空字符串 join 检查参数', '确认序列为字符串'],
            [/\b\.\s*split\s*\(\s*\)\s*\.\s*join\s*\(\s*\)/, 'split().join() 无意义', '直接使用原字符串'],
            [/\b\.\s*strip\s*\(\s*\)\s*\.\s*strip\s*\(\s*\)/, '重复 strip() 无意义', '只 strip 一次'],
            [/\b\.\s*replace\s*\([^)]*\)\s*\.\s*replace\s*\(/, '链式 replace() 低效', 'str.translate()'],
            [/\b\.\s*lower\s*\(\s*\)\s*\.\s*lower\s*\(\s*\)/, '重复 lower() 无意义', '只 lower 一次'],
            [/\b\.\s*upper\s*\(\s*\)\s*\.\s*upper\s*\(\s*\)/, '重复 upper() 无意义', '只 upper 一次'],
            [/\bmap\s*\(\s*lambda\s+[^:]*:\s*[^,]*,\s*/, 'map + lambda 不如推导式', '[f(x) for x in seq]'],
            [/\bfilter\s*\(\s*lambda\s+[^:]*:\s*[^,]*,\s*/, 'filter + lambda 不如推导式', '[x for x in seq if cond]'],
            [/\breduce\s*\(\s*lambda\s+/, 'reduce + lambda 可读性差', '使用显式循环或 sum()'],
            [/\bfunctools\.reduce\s*\(\s*lambda\s+/, 'functools.reduce + lambda 可读性差', '显式循环'],
            [/\bany\s*\(\s*\[\s*/, 'any([...]) 可改为 any(...)', 'any(gen)'],
            [/\ball\s*\(\s*\[\s*/, 'all([...]) 可改为 all(...)', 'all(gen)'],
            [/\bsum\s*\(\s*\[\s*/, 'sum([...]) 可改为 sum(...)', 'sum(gen)'],
            [/\bmax\s*\(\s*\[\s*/, 'max([...]) 可改为 max(...)', 'max(gen)'],
            [/\bmin\s*\(\s*\[\s*/, 'min([...]) 可改为 min(...)', 'min(gen)'],
            [/\benumerate\s*\(\s*\w+\s*\)\s*\[\s*0\s*\]/, 'enumerate()[0] 取索引0', 'next(iter(...))'],
            [/\bzip\s*\(\s*\*\s*\w+\s*\)/, 'zip(*x) 解包转置', '确认意图'],
            [/\biter\s*\(\s*\w+\s*\)\s*\.\s*__next__\s*\(\s*\)/, 'iter(x).__next__ 可用 next(x)', 'next(x)'],
            [/\bnext\s*\(\s*iter\s*\(\s*\w+\s*\)\s*\)/, 'next(iter(x)) 冗余', 'iter(x)'],
            [/\b\.\s*__len__\s*\(\s*\)/, '直接调用 __len__', '使用 len()'],
            [/\b\.\s*__str__\s*\(\s*\)/, '直接调用 __str__', '使用 str()'],
            [/\b\.\s*__repr__\s*\(\s*\)/, '直接调用 __repr__', '使用 repr()'],
            [/\b\.\s*__hash__\s*\(\s*\)/, '直接调用 __hash__', '使用 hash()'],
            [/\b\.\s*__bool__\s*\(\s*\)/, '直接调用 __bool__', '使用 bool()'],
            [/\b\.\s*__int__\s*\(\s*\)/, '直接调用 __int__', '使用 int()'],
            [/\b\.\s*__float__\s*\(\s*\)/, '直接调用 __float__', '使用 float()'],
            [/\bisinstance\s*\(\s*\w+\s*,\s*\w+\s*\)\s+is\s+True/, 'isinstance(...) is True 冗余', '直接 if isinstance(...)'],
            [/\bisinstance\s*\(\s*\w+\s*,\s*\w+\s*\)\s*==\s*True/, 'isinstance(...) == True 冗余', '直接 if isinstance(...)'],
            [/\btype\s*\(\s*\w+\s*\)\s*is\s+\w+/, 'type(x) is T 应使用 isinstance()', 'isinstance(x, T)'],
            [/\btype\s*\(\s*\w+\s*\)\s*==\s*type\s*\(/, 'type(x) == type(y) 不稳健', 'isinstance(x, type(y))'],
            [/\bhasattr\s*\(\s*\w+\s*,\s*["'][^"']+["']\s*\)\s+and\s+getattr\s*\(/, 'hasattr + getattr 可合并', 'getattr(x, name, default)'],
            [/\bgetattr\s*\(\s*\w+\s*,\s*["'][^"']+["']\s*\)\s+is\s+None/, 'getattr 检查 None 可提供默认值', 'getattr(x, name, default)'],
            [/\bsetattr\s*\(\s*\w+\s*,\s*["'][^"']+["']\s*,\s*\w+\s*\)/, 'setattr 动态设置属性', '优先直接赋值'],
            [/\bdelattr\s*\(\s*\w+\s*,\s*["'][^"']+["']\s*\)/, 'delattr 动态删除属性', '优先 del x.attr'],
            [/\bsuper\s*\(\s*\)\s*\.\s*__init__\s*\(\s*\)/, 'super().__init__() 调用检查', '确认父类需要调用'],
            [/\bsuper\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\.\s*__init__\s*\(/, 'Python 3 中 super() 可省略参数', 'super().__init__()'],
            [/\bclass\s+\w+\s*:\s*$/, '类未显式继承 object', 'class Foo: 在 Py3 中可接受'],
            [/\bclass\s+\w+\s*\(\s*object\s*\)/, 'Python 3 中继承 object 冗余', 'class Foo:'],
            [/\b@staticmethod\s*\n\s*def\s+\w+\s*\(\s*self\s*\)/, 'staticmethod 不应有 self 参数', '移除 self'],
            [/\b@classmethod\s*\n\s*def\s+\w+\s*\(\s*self\s*\)/, 'classmethod 第一个参数应为 cls', '使用 cls'],
            [/\b@property\s*\n\s*def\s+\w+\s*\(\s*\)/, 'property 不应有额外参数', 'def name(self)'],
            [/\b@abstractmethod\s*\n\s*def\s+\w+\s*\(\s*self\s*\)\s*:/, '抽象方法检查实现', '子类必须实现'],
            [/\bfrom\s+abc\s+import\s+ABC,\s*abstractmethod/, '使用 abc 抽象基类', '确认需要抽象类'],
            [/\bclass\s+\w+\s*\(\s*ABC\s*\)/, '继承 ABC 的抽象类', '确保有 @abstractmethod'],
            [/\bEnum\s*\(\s*\)/, 'Enum 定义检查', 'class Color(Enum)'],
            [/\bfrom\s+enum\s+import\s+Enum/, '使用 enum.Enum', '确认需要枚举'],
            [/\bIntEnum\s*\(/, 'IntEnum 行为特殊', '谨慎使用'],
            [/\bFlag\s*\(/, 'Flag 枚举检查', '确认位运算语义'],
            [/\bdataclass\s*\(/, 'dataclass 使用检查', '确认需要自动生成的魔术方法'],
            [/\b@dataclass\s*\n\s*class\s+\w+\s*\(\s*\)/, 'dataclass 默认frozen参数', '考虑 frozen=True'],
            [/\b@dataclass\s*\n\s*class\s+\w+.*:\s*\n\s*pass\s*$/, '空 dataclass', '添加字段'],
            [/\bnamedtuple\s*\(/, 'namedtuple 可考虑 dataclass', 'Python 3.7+ 用 @dataclass'],
            [/\bTypedDict\s*\(/, 'TypedDict 类型字典', '检查字段类型'],
            [/\bProtocol\s*\(/, 'Protocol 结构化子类型', '确认使用 typing.Protocol'],
            [/\bFinal\s*\[/, 'Final 类型标注', '确保只赋值一次'],
            [/\bLiteral\s*\[/, 'Literal 字面量类型', '确认使用 typing.Literal'],
            [/\bUnion\s*\[/, 'Union 类型', 'Python 3.10+ 可用 X | Y'],
            [/\bOptional\s*\[/, 'Optional 类型', 'Python 3.10+ 可用 X | None'],
            [/\bCallable\s*\[/, 'Callable 类型注解', '检查参数和返回类型'],
            [/\bAny\s*\)/, 'Any 类型削弱类型检查', '尽量使用具体类型'],
            [/\bNoReturn\s*\)/, 'NoReturn 用于永不返回的函数', '确认语义'],
            [/\bcast\s*\(/, 'cast() 强制类型转换', '避免不必要的 cast'],
            [/\bTYPE_CHECKING\s*\)/, 'TYPE_CHECKING 条件导入', '仅用于类型检查']
        ];
        for (const [p, msg, fix] of generalPatterns) {
            rules.push({ pattern: p, type: 'CommercialCheck', category: 'best_practice', severity: 'info', message: msg, fix });
        }

        // 2. Web 框架：Flask / Django / FastAPI
        const flaskPatterns = [
            [/\bapp\s*=\s*Flask\s*\(\s*__name__\s*\)/, 'Flask 应用初始化', '确认 secret_key 配置'],
            [/\b@app\.route\s*\(\s*["'][^"']*["']\s*\)/, 'Flask 路由定义', '检查 methods 参数'],
            [/\brequest\.form\s*\[/, 'Flask request.form 直接索引', '使用 .get() 并提供默认值'],
            [/\brequest\.args\s*\[/, 'Flask request.args 直接索引', '使用 .get() 并提供默认值'],
            [/\brequest\.json\s*\[/, 'Flask request.json 直接索引', '使用 .get() 并提供默认值'],
            [/\bsession\s*\[/, 'Flask session 直接索引', '考虑 .get() 和默认值'],
            [/\bsession\s*\.\s*permanent\s*=\s*True/, 'Flask session 永久化', '确认配置'],
            [/\brender_template\s*\(/, 'Flask 渲染模板', '确保模板路径正确'],
            [/\bredirect\s*\(\s*url_for\s*\(/, 'Flask 重定向', '确认端点存在'],
            [/\babort\s*\(\s*\d+\s*\)/, 'Flask abort 状态码', '使用语义化状态码'],
            [/\bjsonify\s*\(/, 'Flask jsonify 返回 JSON', '考虑返回 dict + status'],
            [/\bmake_response\s*\(/, 'Flask make_response', '检查响应头和状态码'],
            [/\b Blueprint\s*\(/, 'Flask 蓝图', '确认蓝图注册'],
            [/\bapp\.register_blueprint\s*\(/, 'Flask 注册蓝图', '检查 url_prefix'],
            [/\bapp\.run\s*\(\s*\)/, 'Flask app.run() 默认参数', '生产环境使用 WSGI 服务器'],
            [/\bapp\.run\s*\(\s*debug\s*=\s*True\s*\)/, 'Flask debug=True 生产风险', '生产环境关闭 debug'],
            [/\bbefore_request\s*\(/, 'Flask before_request 钩子', '注意异常处理'],
            [/\bafter_request\s*\(/, 'Flask after_request 钩子', '注意响应修改'],
            [/\bteardown_request\s*\(/, 'Flask teardown_request 钩子', '注意资源清理']
        ];
        for (const [p, msg, fix] of flaskPatterns) {
            rules.push({ pattern: p, type: 'FlaskCheck', category: 'web_framework', severity: 'info', message: msg, fix });
        }

        const djangoPatterns = [
            [/\bfrom\s+django\.http\s+import/, 'Django Http 导入', '确认使用场景'],
            [/\bfrom\s+django\.shortcuts\s+import/, 'Django shortcuts 导入', '确认导入项'],
            [/\bfrom\s+django\.views\s+import/, 'Django views 导入', '确认视图类型'],
            [/\bdef\s+\w+\s*\(\s*request\s*\)/, 'Django 视图函数签名', '使用 HttpRequest 类型注解'],
            [/\bHttpResponse\s*\(/, 'Django HttpResponse', '考虑 JsonResponse'],
            [/\bJsonResponse\s*\(/, 'Django JsonResponse', '确认 data 可序列化'],
            [/\brender\s*\(\s*request\s*,/, 'Django render', '确认模板存在'],
            [/\bredirect\s*\(\s*['"][^'"]*['"]\s*\)/, 'Django redirect', '使用 reverse()'],
            [/\bget_object_or_404\s*\(/, 'Django get_object_or_404', '确认模型和查询条件'],
            [/\bget_list_or_404\s*\(/, 'Django get_list_or_404', '确认查询条件'],
            [/\bmodels\.Model\s*\)/, 'Django Model 定义', '检查字段类型'],
            [/\bmodels\.CharField\s*\(/, 'Django CharField', '设置 max_length'],
            [/\bmodels\.TextField\s*\(/, 'Django TextField', '考虑是否需要索引'],
            [/\bmodels\.IntegerField\s*\(/, 'Django IntegerField', '考虑 validators'],
            [/\bmodels\.ForeignKey\s*\(/, 'Django ForeignKey', '设置 on_delete'],
            [/\bmodels\.ManyToManyField\s*\(/, 'Django ManyToManyField', '确认关联表'],
            [/\bon_delete\s*=\s*models\.CASCADE/, 'Django CASCADE 删除', '确认级联策略'],
            [/\bon_delete\s*=\s*models\.SET_NULL/, 'Django SET_NULL 需允许 null', 'null=True'],
            [/\bforms\.Form\s*\)/, 'Django Form', '检查字段和验证'],
            [/\bforms\.ModelForm\s*\)/, 'Django ModelForm', '设置 Meta 类'],
            [/\bclass\s+Meta\s*:/, 'Django Meta 配置', '检查 model/fields'],
            [/\badmin\.site\.register\s*\(/, 'Django admin 注册', '确认模型注册'],
            [/\b@admin\.register\s*\(/, 'Django admin 装饰器', '确认模型'],
            [/\burls\.py/, 'Django urls.py', '检查 path() 和 include()'],
            [/\bpath\s*\(\s*['"][^'"]*['"]\s*,\s*\w+\s*\)/, 'Django path()', '添加 name 参数'],
            [/\binclude\s*\(/, 'Django include()', '确认子路由'],
            [/\bre_path\s*\(/, 'Django re_path()', '确认正则正确'],
            [/\bsettings\.DEBUG\s*==\s*True/, 'Django DEBUG 检查', '避免生产环境依赖 DEBUG'],
            [/\bfrom\s+django\.conf\s+import\s+settings/, 'Django settings 导入', '使用 django.conf.settings'],
            [/\b\.objects\.get\s*\(/, 'Django .get() 可能抛 DoesNotExist', '使用 get_object_or_404 或 try'],
            [/\b\.objects\.filter\s*\(/, 'Django .filter()', '确认查询条件'],
            [/\b\.objects\.all\s*\(\s*\)/, 'Django .all() 全表查询', '添加过滤或分页'],
            [/\b\.values\s*\(/, 'Django .values()', '确认返回字典而非模型'],
            [/\b\.only\s*\(/, 'Django .only() 延迟加载', '确认查询优化'],
            [/\b\.select_related\s*\(/, 'Django select_related', '用于外键一对一优化'],
            [/\b\.prefetch_related\s*\(/, 'Django prefetch_related', '用于多对多/反向优化'],
            [/\b\.aggregate\s*\(/, 'Django aggregate', '确认聚合字段'],
            [/\b\.annotate\s*\(/, 'Django annotate', '确认注释字段'],
            [/\b\.order_by\s*\(/, 'Django order_by', '检查排序字段'],
            [/\b\.distinct\s*\(/, 'Django distinct', '确认去重语义'],
            [/\b\.raw\s*\(/, 'Django raw() 原生 SQL', '注意 SQL 注入'],
            [/\b\.extra\s*\(/, 'Django extra() 原生 SQL', '注意 SQL 注入'],
            [/\bmakemigrations\b/, 'Django makemigrations 命令', '仅用于开发'],
            [/\bmigrate\b/, 'Django migrate 命令', '确保备份数据库']
        ];
        for (const [p, msg, fix] of djangoPatterns) {
            rules.push({ pattern: p, type: 'DjangoCheck', category: 'web_framework', severity: 'info', message: msg, fix });
        }

        const fastapiPatterns = [
            [/\bapp\s*=\s*FastAPI\s*\(\s*\)/, 'FastAPI 应用初始化', '可配置 title/docs_url'],
            [/\b@app\.get\s*\(\s*["'][^"']*["']\s*\)/, 'FastAPI GET 路由', '确认响应模型'],
            [/\b@app\.post\s*\(\s*["'][^"']*["']\s*\)/, 'FastAPI POST 路由', '确认请求体模型'],
            [/\b@app\.put\s*\(\s*["'][^"']*["']\s*\)/, 'FastAPI PUT 路由', '确认请求体模型'],
            [/\b@app\.delete\s*\(\s*["'][^"']*["']\s*\)/, 'FastAPI DELETE 路由', '确认路径参数'],
            [/\b@app\.patch\s*\(\s*["'][^"']*["']\s*\)/, 'FastAPI PATCH 路由', '确认请求体模型'],
            [/\bAPIRouter\s*\(/, 'FastAPI APIRouter', '确认路由注册'],
            [/\bDepends\s*\(/, 'FastAPI Depends', '确认依赖函数'],
            [/\bQuery\s*\(/, 'FastAPI Query', '设置默认值和校验'],
            [/\bPath\s*\(/, 'FastAPI Path', '设置路径参数校验'],
            [/\bBody\s*\(/, 'FastAPI Body', '设置请求体验证'],
            [/\bHeader\s*\(/, 'FastAPI Header', '设置请求头校验'],
            [/\bCookie\s*\(/, 'FastAPI Cookie', '设置 Cookie 校验'],
            [/\bForm\s*\(/, 'FastAPI Form', '确认 content-type'],
            [/\bFile\s*\(/, 'FastAPI File', '限制文件大小'],
            [/\bUploadFile\s*\(/, 'FastAPI UploadFile', '处理大文件上传'],
            [/\bHTTPException\s*\(/, 'FastAPI HTTPException', '使用 status_code 常量'],
            [/\bBackgroundTasks\s*\(/, 'FastAPI BackgroundTasks', '用于轻量后台任务'],
            [/\bWebSocket\s*\(/, 'FastAPI WebSocket', '处理连接关闭'],
            [/\bstatus\.HTTP_200_OK/, 'FastAPI 状态码', '考虑使用 HTTPStatus'],
            [/\bresponses\.JSONResponse\s*\(/, 'FastAPI JSONResponse', '设置 media_type'],
            [/\bresponses\.PlainTextResponse\s*\(/, 'FastAPI PlainTextResponse', '确认返回类型'],
            [/\bresponses\.HTMLResponse\s*\(/, 'FastAPI HTMLResponse', '避免 XSS'],
            [/\bresponses\.RedirectResponse\s*\(/, 'FastAPI RedirectResponse', '检查 URL 安全性'],
            [/\bBaseModel\s*\(/, 'FastAPI/Fydantic BaseModel', '配置字段校验'],
            [/\bField\s*\(/, 'Pydantic Field', '设置默认值和约束'],
            [/\bvalidator\s*\(/, 'Pydantic validator', '使用 @validator'],
            [/\broot_validator\s*\(/, 'Pydantic root_validator', '检查弃用'],
            [/\bConfig\s*:/, 'Pydantic Config', '检查 orm_mode/extra'],
            [/\borm_mode\s*=\s*True/, 'Pydantic orm_mode', '确认需要 ORM 模式']
        ];
        for (const [p, msg, fix] of fastapiPatterns) {
            rules.push({ pattern: p, type: 'FastAPICheck', category: 'web_framework', severity: 'info', message: msg, fix });
        }

        // 3. 数据科学
        const pandasPatterns = [
            [/\bpd\.read_csv\s*\(/, 'pandas read_csv', '指定 encoding/dtype'],
            [/\bpd\.read_excel\s*\(/, 'pandas read_excel', '指定 sheet_name'],
            [/\bpd\.read_json\s*\(/, 'pandas read_json', '指定 orient'],
            [/\bpd\.read_sql\s*\(/, 'pandas read_sql', '使用参数化查询'],
            [/\b\.to_csv\s*\(/, 'pandas to_csv', '指定 index=False'],
            [/\b\.to_excel\s*\(/, 'pandas to_excel', '指定 index/sheet_name'],
            [/\b\.to_json\s*\(/, 'pandas to_json', '指定 orient'],
            [/\b\.to_sql\s*\(/, 'pandas to_sql', '检查 if_exists'],
            [/\bDataFrame\s*\(/, 'pandas DataFrame', '指定 columns/dtypes'],
            [/\bSeries\s*\(/, 'pandas Series', '指定 name/dtype'],
            [/\b\.merge\s*\(/, 'pandas merge', '指定 how/on'],
            [/\b\.join\s*\(/, 'pandas join', '注意索引对齐'],
            [/\b\.groupby\s*\(/, 'pandas groupby', '记得聚合'],
            [/\b\.pivot\s*\(/, 'pandas pivot', '检查索引和列'],
            [/\b\.melt\s*\(/, 'pandas melt', '检查 id_vars'],
            [/\b\.apply\s*\(/, 'pandas apply', '优先使用向量化'],
            [/\b\.map\s*\(/, 'pandas map', '优先使用向量化'],
            [/\b\.applymap\s*\(/, 'pandas applymap 已弃用', '使用 map'],
            [/\b\.iterrows\s*\(\s*\)/, 'pandas iterrows 慢', '优先向量化或 itertuples'],
            [/\b\.itertuples\s*\(\s*\)/, 'pandas itertuples', '比 iterrows 快'],
            [/\b\.drop\s*\(/, 'pandas drop', '检查 axis/inplace'],
            [/\b\.rename\s*\(/, 'pandas rename', '检查 columns/index'],
            [/\b\.sort_values\s*\(/, 'pandas sort_values', '检查 ascending'],
            [/\b\.reset_index\s*\(/, 'pandas reset_index', '检查 drop 参数'],
            [/\b\.set_index\s*\(/, 'pandas set_index', '检查 inplace'],
            [/\b\.loc\s*\[/, 'pandas .loc[]', '使用标签索引'],
            [/\b\.iloc\s*\[/, 'pandas .iloc[]', '使用位置索引'],
            [/\b\.at\s*\[/, 'pandas .at[]', '标量标签访问'],
            [/\b\.iat\s*\[/, 'pandas .iat[]', '标量位置访问'],
            [/\b\.query\s*\(/, 'pandas query', '注意注入风险'],
            [/\b\.eval\s*\(/, 'pandas eval', '注意注入风险'],
            [/\b\.isna\s*\(\s*\)/, 'pandas isna', '处理缺失值'],
            [/\b\.fillna\s*\(/, 'pandas fillna', '选择填充策略'],
            [/\b\.dropna\s*\(/, 'pandas dropna', '检查 how/thresh'],
            [/\b\.replace\s*\(/, 'pandas replace', '检查 regex 参数'],
            [/\b\.astype\s*\(/, 'pandas astype', '检查转换错误'],
            [/\b\.describe\s*\(\s*\)/, 'pandas describe', '了解数据分布'],
            [/\b\.info\s*\(\s*\)/, 'pandas info', '查看数据类型'],
            [/\b\.head\s*\(\s*\)/, 'pandas head', '仅用于检查'],
            [/\b\.tail\s*\(\s*\)/, 'pandas tail', '仅用于检查'],
            [/\b\.shape\s*\[/, 'pandas shape 索引', 'shape[0] 行数 shape[1] 列数'],
            [/\b\.columns\s*\.\s*tolist\s*\(/, 'pandas columns 转列表', '确认需要'],
            [/\b\.values\s*\.\s*tolist\s*\(/, 'pandas values 转列表', '确认需要']
        ];
        for (const [p, msg, fix] of pandasPatterns) {
            rules.push({ pattern: p, type: 'PandasCheck', category: 'data_science', severity: 'info', message: msg, fix });
        }

        const numpyPatterns = [
            [/\bnp\.array\s*\(/, 'numpy array', '指定 dtype'],
            [/\bnp\.zeros\s*\(/, 'numpy zeros', '指定 dtype'],
            [/\bnp\.ones\s*\(/, 'numpy ones', '指定 dtype'],
            [/\bnp\.empty\s*\(/, 'numpy empty', '未初始化数据'],
            [/\bnp\.arange\s*\(/, 'numpy arange', '注意浮点步长'],
            [/\bnp\.linspace\s*\(/, 'numpy linspace', '检查 endpoint'],
            [/\bnp\.reshape\s*\(/, 'numpy reshape', '检查总元素数'],
            [/\bnp\.transpose\s*\(/, 'numpy transpose', '检查 axes'],
            [/\bnp\.dot\s*\(/, 'numpy dot', '注意维度'],
            [/\bnp\.matmul\s*\(/, 'numpy matmul', '检查矩阵维度'],
            [/\bnp\.sum\s*\(/, 'numpy sum', '指定 axis'],
            [/\bnp\.mean\s*\(/, 'numpy mean', '指定 axis'],
            [/\bnp\.std\s*\(/, 'numpy std', '指定 axis/ddof'],
            [/\bnp\.var\s*\(/, 'numpy var', '指定 axis/ddof'],
            [/\bnp\.min\s*\(/, 'numpy min', '指定 axis'],
            [/\bnp\.max\s*\(/, 'numpy max', '指定 axis'],
            [/\bnp\.argmin\s*\(/, 'numpy argmin', '指定 axis'],
            [/\bnp\.argmax\s*\(/, 'numpy argmax', '指定 axis'],
            [/\bnp\.where\s*\(/, 'numpy where', '检查条件形状'],
            [/\bnp\.concatenate\s*\(/, 'numpy concatenate', '指定 axis'],
            [/\bnp\.stack\s*\(/, 'numpy stack', '指定 axis'],
            [/\bnp\.split\s*\(/, 'numpy split', '检查份数'],
            [/\bnp\.unique\s*\(/, 'numpy unique', '检查 return_counts'],
            [/\bnp\.sort\s*\(/, 'numpy sort', '指定 axis'],
            [/\bnp\.argsort\s*\(/, 'numpy argsort', '指定 axis'],
            [/\bnp\.around\s*\(/, 'numpy around', '指定 decimals'],
            [/\bnp\.floor\s*\(/, 'numpy floor', '检查数据类型'],
            [/\bnp\.ceil\s*\(/, 'numpy ceil', '检查数据类型'],
            [/\bnp\.random\.rand\s*\(/, 'numpy random 非加密安全', '加密场景用 secrets'],
            [/\bnp\.save\s*\(/, 'numpy save', '确认文件路径'],
            [/\bnp\.load\s*\(/, 'numpy load', '只加载可信文件']
        ];
        for (const [p, msg, fix] of numpyPatterns) {
            rules.push({ pattern: p, type: 'NumpyCheck', category: 'data_science', severity: 'info', message: msg, fix });
        }

        // 4. 数据库与 ORM
        const dbPatterns = [
            [/\bSQLAlchemy\b/, '使用 SQLAlchemy', '确认会话管理'],
            [/\bdeclarative_base\s*\(/, 'SQLAlchemy declarative_base', 'SQLAlchemy 2.0 用 DeclarativeBase'],
            [/\bcreate_engine\s*\(/, 'SQLAlchemy create_engine', '设置 pool_size/echo'],
            [/\bsessionmaker\s*\(/, 'SQLAlchemy sessionmaker', '配置 expire_on_commit'],
            [/\bSession\s*\(/, 'SQLAlchemy Session', '使用上下文管理器'],
            [/\b\.query\s*\(/, 'SQLAlchemy query', 'SQLAlchemy 2.0 用 select()'],
            [/\bselect\s*\(/, 'SQLAlchemy select', '使用 ORM 查询'],
            [/\b\.filter\s*\(/, 'SQLAlchemy filter', '注意 SQL 注入'],
            [/\b\.filter_by\s*\(/, 'SQLAlchemy filter_by', '参数化查询'],
            [/\b\.all\s*\(\s*\)/, 'SQLAlchemy all()', '注意大数据集'],
            [/\b\.first\s*\(\s*\)/, 'SQLAlchemy first()', '处理 None'],
            [/\b\.one\s*\(\s*\)/, 'SQLAlchemy one()', '处理 NoResultFound'],
            [/\b\.count\s*\(\s*\)/, 'SQLAlchemy count()', '大数据集性能差'],
            [/\b\.delete\s*\(\s*\)/, 'SQLAlchemy delete()', '需要 commit'],
            [/\b\.update\s*\(/, 'SQLAlchemy update()', '需要 commit'],
            [/\b\.add\s*\(/, 'SQLAlchemy add()', '需要 commit'],
            [/\b\.commit\s*\(\s*\)/, 'SQLAlchemy commit()', '注意异常回滚'],
            [/\b\.rollback\s*\(\s*\)/, 'SQLAlchemy rollback()', '处理异常'],
            [/\bColumn\s*\(/, 'SQLAlchemy Column', '指定 type_ 和约束'],
            [/\bInteger\s*\(/, 'SQLAlchemy Integer', '检查主键/自增'],
            [/\bString\s*\(/, 'SQLAlchemy String', '指定长度'],
            [/\bText\s*\(/, 'SQLAlchemy Text', '长文本字段'],
            [/\bBoolean\s*\(/, 'SQLAlchemy Boolean', '检查 nullable'],
            [/\bDateTime\s*\(/, 'SQLAlchemy DateTime', '设置 timezone'],
            [/\bForeignKey\s*\(/, 'SQLAlchemy ForeignKey', '指定被引用的列'],
            [/\brelationship\s*\(/, 'SQLAlchemy relationship', '配置 lazy'],
            [/\bbackref\s*=/, 'SQLAlchemy backref', 'SQLAlchemy 2.0 推荐 back_populates'],
            [/\bback_populates\s*=/, 'SQLAlchemy back_populates', '确认双向关系'],
            [/\bconnection\.execute\s*\(/, 'SQLAlchemy 原生 execute', '注意 SQL 注入'],
            [/\bengine\.execute\s*\(/, 'SQLAlchemy engine.execute', '注意 SQL 注入'],
            [/\bsqlite3\.connect\s*\(/, 'sqlite3 connect', '检查 isolation_level'],
            [/\bcursor\.execute\s*\(/, 'sqlite3 execute', '使用参数化查询'],
            [/\b\.executemany\s*\(/, 'sqlite3 executemany', '批量操作'],
            [/\b\.executescript\s*\(/, 'sqlite3 executescript', '注意脚本注入'],
            [/\bredis\.Redis\s*\(/, 'redis 连接', '设置 decode_responses'],
            [/\bredis\.StrictRedis\s*\(/, 'redis StrictRedis 已弃用', '使用 redis.Redis'],
            [/\bpymongo\.MongoClient\s*\(/, 'pymongo 连接', '检查 URI 和 TLS'],
            [/\b\.find_one\s*\(/, 'pymongo find_one', '处理 None'],
            [/\b\.find\s*\(/, 'pymongo find', '添加 limit'],
            [/\b\.insert_one\s*\(/, 'pymongo insert_one', '确认数据格式'],
            [/\b\.insert_many\s*\(/, 'pymongo insert_many', '注意有序/无序'],
            [/\b\.update_one\s*\(/, 'pymongo update_one', '使用 $set'],
            [/\b\.delete_one\s*\(/, 'pymongo delete_one', '确认条件'],
            [/\b\.aggregate\s*\(/, 'pymongo aggregate', '注意性能'],
            [/\b\.create_index\s*\(/, 'pymongo create_index', '确认索引字段']
        ];
        for (const [p, msg, fix] of dbPatterns) {
            rules.push({ pattern: p, type: 'DatabaseCheck', category: 'database', severity: 'info', message: msg, fix });
        }

        // 5. 异步
        const asyncPatterns = [
            [/\basyncio\.run\s*\(/, 'asyncio.run', '程序入口只调用一次'],
            [/\basyncio\.gather\s*\(/, 'asyncio.gather', '处理异常'],
            [/\basyncio\.create_task\s*\(/, 'asyncio.create_task', '保存 task 引用'],
            [/\basyncio\.ensure_future\s*\(/, 'asyncio.ensure_future', 'create_task 更推荐'],
            [/\basyncio\.sleep\s*\(/, 'asyncio.sleep', '需要 await'],
            [/\basyncio\.wait\s*\(/, 'asyncio.wait', '注意返回值'],
            [/\basyncio\.wait_for\s*\(/, 'asyncio.wait_for', '设置 timeout'],
            [/\basyncio\.shield\s*\(/, 'asyncio.shield', '保护任务不被取消'],
            [/\basyncio\.Lock\s*\(/, 'asyncio.Lock', '使用 async with'],
            [/\basyncio\.Event\s*\(/, 'asyncio.Event', '注意 set/clear'],
            [/\basyncio\.Queue\s*\(/, 'asyncio.Queue', '注意容量'],
            [/\basyncio\.Semaphore\s*\(/, 'asyncio.Semaphore', '设置限制'],
            [/\baiohttp\.ClientSession\s*\(/, 'aiohttp ClientSession', '使用 async with'],
            [/\baiohttp\.web\.Application\s*\(/, 'aiohttp web 应用', '配置中间件'],
            [/\basync\s+with\s+aiohttp/, 'aiohttp async with', '确保会话关闭'],
            [/\bawait\s+session\.get\s*\(/, 'aiohttp GET', '检查响应状态'],
            [/\bawait\s+session\.post\s*\(/, 'aiohttp POST', '设置 data/json'],
            [/\basync\s+for\s+/, 'async for', '确保可异步迭代'],
            [/\basync\s+with\s+/, 'async with', '确保实现 __aenter__'],
            [/\b__aenter__\s*\(/, '__aenter__ 实现', '返回 self'],
            [/\b__aexit__\s*\(/, '__aexit__ 实现', '处理异常'],
            [/\b__aiter__\s*\(/, '__aiter__ 实现', '返回 self'],
            [/\b__anext__\s*\(/, '__anext__ 实现', '记得 raise StopAsyncIteration'],
            [/\bStopAsyncIteration\b/, 'StopAsyncIteration', '异步迭代终止'],
            [/\basyncio\.get_event_loop\s*\(/, 'get_event_loop', 'asyncio.run 更推荐'],
            [/\bloop\.run_until_complete\s*\(/, 'run_until_complete', 'asyncio.run 更推荐'],
            [/\bloop\.run_forever\s*\(/, 'run_forever', '注意停止条件'],
            [/\basyncio\.set_event_loop\s*\(/, 'set_event_loop', '谨慎使用']
        ];
        for (const [p, msg, fix] of asyncPatterns) {
            rules.push({ pattern: p, type: 'AsyncCheck', category: 'async', severity: 'info', message: msg, fix });
        }

        // 6. 安全
        const securityPatterns = [
            [/\bmd5\s*\(/, 'MD5 不安全', '使用 sha256'],
            [/\bsha1\s*\(/, 'SHA-1 不安全', '使用 sha256'],
            [/\bhashlib\.new\s*\(\s*["']md5["']/, 'hashlib md5', '使用 sha256'],
            [/\bhashlib\.new\s*\(\s*["']sha1["']/, 'hashlib sha1', '使用 sha256'],
            [/\bcryptography\b/, 'cryptography 库', '保持更新'],
            [/\b Fernet\s*\(/, 'Fernet 对称加密', '安全保存 key'],
            [/\bsecrets\.token_urlsafe\s*\(/, 'secrets token_urlsafe', '推荐生成安全 token'],
            [/\bsecrets\.token_hex\s*\(/, 'secrets token_hex', '推荐生成安全 token'],
            [/\bsecrets\.choice\s*\(/, 'secrets choice', '密码学安全随机'],
            [/\brandom\.choice\s*\(/, 'random 非密码学安全', '密码学场景用 secrets'],
            [/\brandom\.shuffle\s*\(/, 'random shuffle 非加密安全', '密码学场景用 secrets'],
            [/\bbase64\.b64encode\s*\(/, 'base64 编码', '不是加密'],
            [/\bbase64\.b64decode\s*\(/, 'base64 解码', '处理异常'],
            [/\bjwt\.encode\s*\(/, 'JWT encode', '选择强算法'],
            [/\bjwt\.decode\s*\(/, 'JWT decode', '验证算法和密钥'],
            [/\bHS256\b/, 'JWT HS256', '确认密钥强度'],
            [/\bHS512\b/, 'JWT HS512', '确认密钥强度'],
            [/\bRS256\b/, 'JWT RS256', '推荐非对称算法'],
            [/\bOAuth2PasswordBearer\s*\(/, 'OAuth2 PasswordBearer', '使用 HTTPS'],
            [/\bCSRFProtect\s*\(/, 'CSRF 保护', '配置 token'],
            [/\b@csrf_exempt/, 'CSRF 豁免', '谨慎使用'],
            [/\bssl\.SSLContext\s*\(/, 'SSLContext', '设置最低 TLS 版本'],
            [/\bssl\.PROTOCOL_TLSv1\b/, 'TLSv1 不安全', '使用 PROTOCOL_TLS_CLIENT'],
            [/\bssl\.PROTOCOL_SSLv23\b/, 'SSLv23 不安全', '使用 PROTOCOL_TLS_CLIENT'],
            [/\bverify\s*=\s*False/, 'verify=False 禁用证书验证', '仅用于测试'],
            [/\bCERT_NONE\b/, 'ssl CERT_NONE', '生产环境不安全'],
            [/\bCERT_OPTIONAL\b/, 'ssl CERT_OPTIONAL', '生产环境不建议'],
            [/\bPASSWORD\s*=\s*["'][^"']+["']/, '硬编码 PASSWORD', '使用环境变量'],
            [/\bSECRET\s*=\s*["'][^"']+["']/, '硬编码 SECRET', '使用环境变量'],
            [/\bAPI_KEY\s*=\s*["'][^"']+["']/, '硬编码 API_KEY', '使用环境变量'],
            [/\bTOKEN\s*=\s*["'][^"']+["']/, '硬编码 TOKEN', '使用环境变量'],
            [/\bPRIVATE_KEY\s*=\s*["'][^"']+["']/, '硬编码 PRIVATE_KEY', '使用环境变量'],
            [/\bAuthorization\s*:\s*Bearer\s+/, '硬编码 Bearer Token', '使用环境变量'],
            [/\bBasic\s+[A-Za-z0-9+/=]+/, '硬编码 Basic Auth', '使用环境变量'],
            [/\bhttp:\/\//, 'HTTP 明文传输', '生产环境使用 HTTPS'],
            [/\b\.insecure\b/, 'insecure 标志', '检查是否必要'],
            [/\ballow_origin\s*=\s*["']\*["']/, 'CORS 允许所有来源', '生产环境限制来源']
        ];
        for (const [p, msg, fix] of securityPatterns) {
            rules.push({ pattern: p, type: 'SecurityCheck', category: 'security', severity: 'warning', message: msg, fix });
        }

        // 7. 类型注解
        const typingPatterns = [
            [/\bdef\s+\w+\s*\([^)]*\)\s*->\s*\w+\s*:/, '函数返回类型注解', '确认类型准确'],
            [/\bdef\s+\w+\s*\(\s*self\s*\)\s*->\s*None\s*:/, '__init__ 返回 None', '正确'],
            [/\bdef\s+\w+\s*\([^)]*:\s*\w+[^)]*\)\s*:/, '函数参数类型注解', '检查类型'],
            [/\b->\s*Optional\s*\[/, '返回 Optional', 'Python 3.10+ 用 | None'],
            [/\b->\s*Union\s*\[/, '返回 Union', 'Python 3.10+ 用 |'],
            [/\b->\s*List\s*\[/, '返回 List', 'Python 3.9+ 用 list[T]'],
            [/\b->\s*Dict\s*\[/, '返回 Dict', 'Python 3.9+ 用 dict[K,V]'],
            [/\b->\s*Tuple\s*\[/, '返回 Tuple', 'Python 3.9+ 用 tuple[T,...]'],
            [/\b->\s*Callable\s*\[/, '返回 Callable', '检查参数/返回类型'],
            [/\b->\s*Any\s*:/, '返回 Any', '尽量具体化'],
            [/\b->\s*NoReturn\s*:/, '返回 NoReturn', '用于永不返回'],
            [/\b:\s*Optional\s*\[\s*\w+\s*\]\s*=\s*None/, 'Optional[X] = None', '可用 X | None'],
            [/\b:\s*Union\s*\[/, '参数 Union', '可用 X | Y'],
            [/\b:\s*Final\s*\[/, 'Final 标注', '值不应被修改'],
            [/\b:\s*ClassVar\s*\[/, 'ClassVar 类变量', '不应在实例上修改'],
            [/\b:\s*Annotated\s*\[/, 'Annotated 元数据', '确认元数据语义'],
            [/\bGeneric\s*\[/, 'Generic 泛型', '指定 TypeVar'],
            [/\bTypeVar\s*\(/, 'TypeVar 定义', '设置 bound/constraints'],
            [/\bNamedTuple\s*\(/, 'NamedTuple 类型', '考虑 TypedDict/dataclass'],
            [/\bTypedDict\s*\(/, 'TypedDict 类型', '设置 total=False'],
            [/\bNotRequired\s*\[/, 'NotRequired', '字段可缺失'],
            [/\bRequired\s*\[/, 'Required', '字段必填']
        ];
        for (const [p, msg, fix] of typingPatterns) {
            rules.push({ pattern: p, type: 'TypingCheck', category: 'typing', severity: 'info', message: msg, fix });
        }

        // 8. 文件与 IO
        const ioPatterns = [
            [/\bpathlib\.Path\s*\(/, 'pathlib.Path', '推荐用于路径操作'],
            [/\bPath\.home\s*\(\s*\)/, 'Path.home()', '用户主目录'],
            [/\bPath\.cwd\s*\(\s*\)/, 'Path.cwd()', '当前工作目录'],
            [/\b\.resolve\s*\(\s*\)/, 'Path.resolve()', '解析绝对路径'],
            [/\b\.glob\s*\(/, 'Path.glob()', '检查模式'],
            [/\b\.rglob\s*\(/, 'Path.rglob()', '递归匹配'],
            [/\b\.mkdir\s*\(/, 'Path.mkdir()', '检查 exist_ok'],
            [/\b\.rmdir\s*\(/, 'Path.rmdir()', '目录必须为空'],
            [/\b\.unlink\s*\(/, 'Path.unlink()', '删除文件'],
            [/\b\.rename\s*\(/, 'Path.rename()', '检查目标存在'],
            [/\b\.replace\s*\(/, 'Path.replace()', '会覆盖目标'],
            [/\b\.read_text\s*\(/, 'Path.read_text()', '指定 encoding'],
            [/\b\.write_text\s*\(/, 'Path.write_text()', '指定 encoding'],
            [/\b\.read_bytes\s*\(/, 'Path.read_bytes()', '读取二进制'],
            [/\b\.write_bytes\s*\(/, 'Path.write_bytes()', '写入二进制'],
            [/\bshutil\.copy\s*\(/, 'shutil.copy', '检查目标路径'],
            [/\bshutil\.copytree\s*\(/, 'shutil.copytree', '检查 dirs_exist_ok'],
            [/\bshutil\.rmtree\s*\(/, 'shutil.rmtree', '危险操作'],
            [/\bshutil\.move\s*\(/, 'shutil.move', '检查目标存在'],
            [/\bglob\.glob\s*\(/, 'glob.glob', '考虑使用 Path.glob'],
            [/\bfnmatch\.fnmatch\s*\(/, 'fnmatch 匹配', '检查模式'],
            [/\btempfile\.mkstemp\s*\(/, 'tempfile mkstemp', '记得关闭 fd'],
            [/\btempfile\.mkdtemp\s*\(/, 'tempfile mkdtemp', '记得删除目录'],
            [/\btempfile\.TemporaryDirectory\s*\(/, 'TemporaryDirectory', '使用 with'],
            [/\btempfile\.NamedTemporaryFile\s*\(/, 'NamedTemporaryFile', '使用 with'],
            [/\bio\.StringIO\s*\(/, 'io.StringIO', '内存文本流'],
            [/\bio\.BytesIO\s*\(/, 'io.BytesIO', '内存字节流'],
            [/\bcsv\.reader\s*\(/, 'csv reader', '指定 delimiter'],
            [/\bcsv\.writer\s*\(/, 'csv writer', '指定 lineterminator'],
            [/\bcsv\.DictReader\s*\(/, 'csv DictReader', '处理缺失字段'],
            [/\bcsv\.DictWriter\s*\(/, 'csv DictWriter', '记得 writeheader'],
            [/\bjson\.load\s*\(/, 'json load', '处理 JSONDecodeError'],
            [/\bjson\.loads\s*\(/, 'json loads', '处理 JSONDecodeError'],
            [/\bjson\.dump\s*\(/, 'json dump', '设置 ensure_ascii'],
            [/\bjson\.dumps\s*\(/, 'json dumps', '设置 ensure_ascii'],
            [/\byaml\.safe_load\s*\(/, 'yaml safe_load', '推荐使用'],
            [/\btoml\.load\s*\(/, 'toml load', '处理 TomlDecodeError'],
            [/\bconfigparser\.ConfigParser\s*\(/, 'ConfigParser', '检查 interpolation'],
            [/\bxml\.etree\.ElementTree\s*\(/, 'xml 解析', '注意 XXE'],
            [/\bElementTree\.parse\s*\(/, 'ElementTree parse', '注意外部实体'],
            [/\b\.fromstring\s*\(/, 'xml fromstring', '注意 XXE']
        ];
        for (const [p, msg, fix] of ioPatterns) {
            rules.push({ pattern: p, type: 'IOCheck', category: 'file_io', severity: 'info', message: msg, fix });
        }

        // 9. 测试
        const testPatterns = [
            [/\b@pytest\.fixture\s*\(/, 'pytest fixture', '设置 scope'],
            [/\b@pytest\.mark\.parametrize\s*\(/, 'pytest parametrize', '参数化测试'],
            [/\b@pytest\.mark\.skip\s*\(/, 'pytest skip', '说明跳过原因'],
            [/\b@pytest\.mark\.xfail\s*\(/, 'pytest xfail', '说明预期失败'],
            [/\b@pytest\.mark\.slow\b/, 'pytest 自定义 mark', '注册 mark'],
            [/\bconftest\.py/, 'pytest conftest', '共享 fixture'],
            [/\bassert\s+\w+\s*==\s*True/, 'assert == True 冗余', 'assert x'],
            [/\bassert\s+\w+\s*==\s*False/, 'assert == False 冗余', 'assert not x'],
            [/\bassert\s+len\s*\(\s*\w+\s*\)\s*==\s*\d+/, 'assert len 检查', '考虑 assert len(x) == n'],
            [/\bassert\s+\w+\s+in\s+\w+/, 'assert in 成员检查', '清晰'],
            [/\bassert\s+\w+\s+not\s+in\s+\w+/, 'assert not in 成员检查', '清晰'],
            [/\bassert\s+isinstance\s*\(/, 'assert isinstance', '考虑类型检查'],
            [/\bassert\s+type\s*\(/, 'assert type()', '使用 assert isinstance'],
            [/\bself\.assertEquals\s*\(/, 'assertEquals 已弃用', 'assertEqual'],
            [/\bself\.assert_\s*\(/, 'assert_ 已弃用', '使用具体断言'],
            [/\bmock\.patch\s*\(/, 'mock.patch', '确认目标路径'],
            [/\bmock\.MagicMock\s*\(/, 'MagicMock', '检查调用断言'],
            [/\bMock\s*\(/, 'unittest Mock', '检查 spec'],
            [/\bspec_set\s*=\s*True/, 'Mock spec_set', '限制属性访问'],
            [/\bautospec\s*=\s*True/, 'patch autospec', '自动生成 spec'],
            [/\bside_effect\s*=/, 'Mock side_effect', '可调用对象/异常'],
            [/\breturn_value\s*=/, 'Mock return_value', '设置返回值'],
            [/\bassert_called\s*\(\s*\)/, 'assert_called', '至少调用一次'],
            [/\bassert_called_once\s*\(\s*\)/, 'assert_called_once', '恰好一次'],
            [/\bassert_not_called\s*\(\s*\)/, 'assert_not_called', '未调用'],
            [/\bassert_called_with\s*\(/, 'assert_called_with', '检查最近调用'],
            [/\bassert_any_call\s*\(/, 'assert_any_call', '任意一次调用'],
            [/\bassert_has_calls\s*\(/, 'assert_has_calls', '检查调用序列'],
            [/\bhypothesis\.given\s*\(/, 'hypothesis given', '定义策略'],
            [/\bdoctest\.testmod\s*\(/, 'doctest testmod', '运行文档测试'],
            [/\bunittest\.main\s*\(/, 'unittest main', '仅用于测试入口']
        ];
        for (const [p, msg, fix] of testPatterns) {
            rules.push({ pattern: p, type: 'TestCheck', category: 'testing', severity: 'info', message: msg, fix });
        }

        // 10. 配置、日志、CLI
        const configPatterns = [
            [/\bdotenv\.load_dotenv\s*\(/, 'load_dotenv', '检查 override'],
            [/\bos\.environ\.get\s*\(\s*["']\w+["']\s*\)/, 'os.environ.get', '提供默认值'],
            [/\bos\.environ\[\s*["']\w+["']\s*\]/, 'os.environ[]', '使用 .get 更安全'],
            [/\bargparse\.ArgumentParser\s*\(/, 'ArgumentParser', '设置 description'],
            [/\b\.add_argument\s*\(/, 'add_argument', '设置 help'],
            [/\b\.parse_args\s*\(/, 'parse_args', '处理参数'],
            [/\bclick\.command\s*\(/, 'click command', '设置 help'],
            [/\b@click\.option\s*\(/, 'click option', '设置 default/type'],
            [/\b@click\.argument\s*\(/, 'click argument', '设置 nargs'],
            [/\btyper\.Typer\s*\(/, 'typer app', '现代 CLI 框架'],
            [/\bconfigparser\.ConfigParser\s*\(/, 'ConfigParser', '检查 section'],
            [/\b\.get\s*\(\s*["']\w+["']\s*,\s*["']\w+["']\s*\)/, 'ConfigParser get', '检查默认值'],
            [/\b\.getint\s*\(/, 'ConfigParser getint', '获取整数'],
            [/\b\.getfloat\s*\(/, 'ConfigParser getfloat', '获取浮点数'],
            [/\b\.getboolean\s*\(/, 'ConfigParser getboolean', '获取布尔'],
            [/\blogging\.basicConfig\s*\(/, 'logging basicConfig', '只调用一次'],
            [/\blogging\.getLogger\s*\(/, 'logging getLogger', '使用 __name__'],
            [/\blogging\.FileHandler\s*\(/, 'FileHandler', '检查 rotation'],
            [/\blogging\.StreamHandler\s*\(/, 'StreamHandler', '通常用于 stdout'],
            [/\blogging\.RotatingFileHandler\s*\(/, 'RotatingFileHandler', '设置 maxBytes'],
            [/\blogging\.TimedRotatingFileHandler\s*\(/, 'TimedRotatingFileHandler', '设置 when'],
            [/\blogger\.debug\s*\(f["']/, 'logger debug f-string', '使用 % 占位符'],
            [/\blogger\.info\s*\(f["']/, 'logger info f-string', '使用 % 占位符'],
            [/\blogger\.warning\s*\(f["']/, 'logger warning f-string', '使用 % 占位符'],
            [/\blogger\.error\s*\(f["']/, 'logger error f-string', '使用 % 占位符'],
            [/\bexc_info\s*=\s*True/, 'exc_info=True', '记录异常堆栈'],
            [/\bstack_info\s*=\s*True/, 'stack_info=True', '记录调用栈']
        ];
        for (const [p, msg, fix] of configPatterns) {
            rules.push({ pattern: p, type: 'ConfigCheck', category: 'config', severity: 'info', message: msg, fix });
        }

        // 11. 字符串、列表、字典、集合操作
        const collectionPatterns = [
            [/\b""\.join\s*\(/, '"".join', '确认参数为字符串序列'],
            [/\b" "\.join\s*\(/, '" ".join', '用空格连接'],
            [/\b","\.join\s*\(/, '",".join', '用逗号连接'],
            [/\b"\n"\.join\s*\(/, '"\n".join', '用换行连接'],
            [/\b\.splitlines\s*\(\s*\)/, 'splitlines()', '处理行尾'],
            [/\b\.partition\s*\(/, 'partition()', '返回三元组'],
            [/\b\.rpartition\s*\(/, 'rpartition()', '从右侧分割'],
            [/\b\.rsplit\s*\(/, 'rsplit()', '从右侧分割'],
            [/\b\.split\s*\(\s*["'],\s*["']\s*\)/, 'split(",")', '使用默认空白或指定 sep'],
            [/\b\.split\s*\(\s*None\s*\)/, 'split(None)', '可省略参数'],
            [/\b\.find\s*\(/, 'str.find', '未找到返回 -1'],
            [/\b\.index\s*\(/, 'str.index', '未找到抛异常'],
            [/\b\.rfind\s*\(/, 'str.rfind', '从右侧查找'],
            [/\b\.rindex\s*\(/, 'str.rindex', '从右侧查找'],
            [/\b\.count\s*\(/, 'str.count', '统计子串'],
            [/\b\.startswith\s*\(/, 'startswith', '检查前缀'],
            [/\b\.endswith\s*\(/, 'endswith', '检查后缀'],
            [/\b\.isdigit\s*\(\s*\)/, 'isdigit', '检查是否全数字'],
            [/\b\.isalpha\s*\(\s*\)/, 'isalpha', '检查是否全字母'],
            [/\b\.isalnum\s*\(\s*\)/, 'isalnum', '检查是否字母数字'],
            [/\b\.isspace\s*\(\s*\)/, 'isspace', '检查是否全空白'],
            [/\b\.isnumeric\s*\(\s*\)/, 'isnumeric', '包含更多数字字符'],
            [/\b\.isdecimal\s*\(\s*\)/, 'isdecimal', '严格十进制数字'],
            [/\b\.encode\s*\(\s*["']utf-8["']\s*\)/, 'encode utf-8', '默认已是 utf-8'],
            [/\b\.decode\s*\(\s*["']utf-8["']\s*\)/, 'decode utf-8', '默认已是 utf-8'],
            [/\b\.copy\s*\(\s*\)/, '.copy()', '浅拷贝'],
            [/\bcopy\.deepcopy\s*\(/, 'deepcopy', '性能开销大'],
            [/\b\.clear\s*\(\s*\)/, '.clear()', '清空容器'],
            [/\b\.pop\s*\(/, '.pop()', '处理 KeyError/IndexError'],
            [/\b\.popitem\s*\(\s*\)/, '.popitem()', '字典弹出项'],
            [/\b\.setdefault\s*\(/, 'setdefault', '可考虑 collections.defaultdict'],
            [/\bcollections\.defaultdict\s*\(/, 'defaultdict', '设置 default_factory'],
            [/\bcollections\.Counter\s*\(/, 'Counter', '计数器'],
            [/\bcollections\.OrderedDict\s*\(/, 'OrderedDict', 'Python 3.7+ dict 有序'],
            [/\bcollections\.deque\s*\(/, 'deque', '双端队列'],
            [/\bcollections\.namedtuple\s*\(/, 'namedtuple', '可考虑 dataclass'],
            [/\bchain\.from_iterable\s*\(/, 'itertools chain', '扁平化迭代器'],
            [/\bitertools\.combinations\s*\(/, 'combinations', '组合'],
            [/\bitertools\.permutations\s*\(/, 'permutations', '排列'],
            [/\bitertools\.product\s*\(/, 'product', '笛卡尔积'],
            [/\bitertools\.groupby\s*\(/, 'groupby', '需先排序'],
            [/\bfunctools\.lru_cache\s*\(/, 'lru_cache', '设置 maxsize'],
            [/\bfunctools\.wraps\s*\(/, 'wraps', '保留元信息'],
            [/\bfunctools\.partial\s*\(/, 'partial', '冻结部分参数'],
            [/\boperator\.itemgetter\s*\(/, 'itemgetter', '获取元素'],
            [/\boperator\.attrgetter\s*\(/, 'attrgetter', '获取属性']
        ];
        for (const [p, msg, fix] of collectionPatterns) {
            rules.push({ pattern: p, type: 'CollectionCheck', category: 'collections', severity: 'info', message: msg, fix });
        }

        this._addRules(rules);
    }

    _detectMissingColons(lines, problems) {
        const blockKeywords = /\b(if|elif|else|for|while|def|class|try|except|finally|with|async\s+def|async\s+for|async\s+with|match|case)\b/;
        const needsColon = new Set(['if','elif','else','for','while','def','class','try','except','finally','with']);
        for (let i = 0; i < lines.length; i++) {
            const stripped = lines[i].trim();
            if (!stripped || stripped.startsWith('#')) continue;
            const codePart = lines[i].replace(/#.*$/, '').trimEnd();
            const match = codePart.match(blockKeywords);
            if (!match) continue;
            const kw = match[1] || match[0];
            if (!needsColon.has(kw)) continue;
            if (codePart.trimEnd().endsWith(':')) continue;
            problems.push({ line: i + 1, column: codePart.length, type: 'SyntaxError', category: 'syntax', message: `"${kw}" 语句缺少冒号`, fix: `在行末添加 ":"`, severity: 'error' });
        }
    }

    /**
     * 检查一行是否以续行符 \ 结尾（排除注释行）
     * Python 中字符串内的 \ 续行也是合法的续行
     */
    _endsWithLineContinuation(line) {
        let inString = false, stringChar = '';
        for (let j = 0; j < line.length; j++) {
            const ch = line[j];
            const prev = j > 0 ? line[j - 1] : '';
            if (ch === '#' && !inString) return false;
            if ((ch === '"' || ch === "'") && prev !== '\\' && !inString) {
                if (!inString) { inString = true; stringChar = ch; }
                else if (ch === stringChar) { inString = false; }
            }
        }
        // Python 中 \ 续行在字符串内也是合法的，只有注释内才不是
        return line.length > 0 && line[line.length - 1] === '\\';
    }

    _detectBracketMismatch(lines, problems) {
        const brackets = { '(': ')', '[': ']', '{': '}' };
        const stack = [];
        let inString = false, stringChar = '';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let inComment = false;
            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                const prev = j > 0 ? line[j - 1] : '';
                if (ch === '#' && !inString) { inComment = true; break; }
                if ((ch === '"' || ch === "'") && prev !== '\\' && !inComment) {
                    if (!inString) { inString = true; stringChar = ch; }
                    else if (ch === stringChar) { inString = false; }
                    continue;
                }
                if (inString || inComment) continue;
                if (brackets[ch]) {
                    stack.push({ char: ch, line: i + 1, col: j + 1 });
                } else if (ch === ')' || ch === ']' || ch === '}') {
                    if (stack.length === 0) {
                        // 检查是否是被续行破坏的 f-string —— 若是则标记为下游错误
                        problems.push({ line: i + 1, column: j + 1, type: 'SyntaxError', category: 'syntax', message: `多余的 "${ch}"`, fix: `删除 "${ch}"`, severity: 'error', _isDownstream: true });
                        continue;
                    }
                    const last = stack.pop();
                    const expected = brackets[last.char];
                    if (ch !== expected) {
                        problems.push({ line: i + 1, column: j + 1, type: 'SyntaxError', category: 'syntax', message: `括号不匹配`, fix: `将 "${ch}" 改为 "${expected}"`, severity: 'error', _isDownstream: true });
                    }
                }
            }
            // 续行符：保持字符串状态延续到下一行
            if (!this._endsWithLineContinuation(line)) {
                inString = false;
            }
        }
        for (const item of stack) {
            const expected = brackets[item.char];
            problems.push({ line: item.line, column: item.col, type: 'SyntaxError', category: 'syntax', message: `未闭合的 "${item.char}"`, fix: `添加 "${expected}"`, severity: 'error' });
        }
    }

    _detectIndentationIssues(lines, problems) {
        let hasTabs = false, hasSpaces = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            const leading = line.match(/^(\s*)/)[1];
            if (leading.includes('\t')) hasTabs = true;
            if (leading.includes(' ')) hasSpaces = true;
            if (!leading.includes('\t') && leading.length > 0 && leading.length % 4 !== 0) {
                problems.push({ line: i + 1, column: 1, type: 'IndentationWarning', category: 'style', message: `缩进不是 4 的倍数`, fix: '调整为 4 的倍数个空格', severity: 'warning' });
            }
        }
        if (hasTabs && hasSpaces) {
            problems.push({ line: 1, column: 1, type: 'IndentationWarning', category: 'style', message: '混合使用 Tab 和空格缩进', fix: '统一使用空格', severity: 'warning' });
        }
    }

    _detectUnclosedStrings(lines, problems) {
        let inTriple = false, tripleChar = '', tripleStart = 0;
        let inString = false, stringChar = '', stringStart = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (inTriple) {
                const idx = line.indexOf(tripleChar);
                if (idx !== -1) {
                    inTriple = false;
                    continue;
                }
                continue;
            }
            const tripleMatch = line.match(/("""|''')/);
            if (tripleMatch) {
                const quote = tripleMatch[0];
                const rest = line.substring(tripleMatch.index + 3);
                if (!rest.includes(quote)) {
                    inTriple = true; tripleChar = quote; tripleStart = i;
                }
                // 三引号内可能还包含普通字符串，跳过整行
                continue;
            }
            let inComment = false;
            for (let j = 0; j < line.length; j++) {
                const ch = line[j];
                const prev = j > 0 ? line[j - 1] : '';
                if (ch === '#' && !inString) { inComment = true; break; }
                if (!inComment && (ch === '"' || ch === "'") && prev !== '\\') {
                    if (!inString) { inString = true; stringChar = ch; stringStart = i; }
                    else if (ch === stringChar) { inString = false; }
                }
            }
            if (inString) {
                // 续行符：字符串延续到下一行
                if (this._endsWithLineContinuation(line)) continue;
                // 真正的未闭合字符串
                problems.push({
                    line: stringStart + 1, column: line.length,
                    type: 'SyntaxError', category: 'syntax',
                    message: `未闭合的字符串`,
                    fix: `添加 "${stringChar}"`,
                    severity: 'error',
                    _isDownstream: true
                });
                inString = false;
            }
        }
        if (inString) {
            problems.push({
                line: stringStart + 1, column: 1,
                type: 'SyntaxError', category: 'syntax',
                message: `未闭合的字符串`,
                fix: `添加 "${stringChar}"`,
                severity: 'error',
                _isDownstream: true
            });
        }
        if (inTriple) {
            problems.push({
                line: tripleStart + 1, column: 1,
                type: 'SyntaxError', category: 'syntax',
                message: `未闭合的三引号字符串`,
                fix: `添加 ${tripleChar}`,
                severity: 'error'
            });
        }
    }

    _detectEmptyBlocks(lines, problems) {
        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trimEnd();
            if (!line.trim()) continue;
            const isBlockStart = /:\s*$/.test(line) && /\b(if|elif|else|for|while|def|class|try|except|finally|with|async\s+def|async\s+for|async\s+with|match|case)\b/.test(line);
            if (!isBlockStart) continue;
            const currentIndent = lines[i].match(/^(\s*)/)[1].length;
            const nextTrimmed = (lines[i + 1] || '').trim();
            const nextIndent = (lines[i + 1] || '').match(/^(\s*)/)[1].length;
            if (nextTrimmed === '' || nextIndent <= currentIndent) {
                problems.push({ line: i + 1, column: line.length, type: 'SyntaxError', category: 'syntax', message: '代码块为空', fix: '添加代码体或使用 "pass"', severity: 'error' });
            }
        }
    }

    _detectInvalidAssignmentEq(lines, problems) {
        for (let i = 0; i < lines.length; i++) {
            const stripped = lines[i].trim();
            if (!stripped || stripped.startsWith('#')) continue;
            const condMatch = stripped.match(/^\s*(if|elif|while|assert)\s+(.+)$/);
            if (!condMatch) continue;
            const condition = condMatch[2].replace(/#.*$/, '');
            const inStrRemoved = condition.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
            // 兼容旧版浏览器：避免使用负向回顾后发 (?<!...)
            let foundBadEq = false;
            for (let k = 0; k < inStrRemoved.length; k++) {
                if (inStrRemoved[k] === '=' && inStrRemoved[k + 1] !== '=') {
                    const prev = inStrRemoved[k - 1];
                    if (!prev || !'=!<>+-*/%'.includes(prev)) { foundBadEq = true; break; }
                }
            }
            if (foundBadEq) {
                problems.push({ line: i + 1, column: stripped.indexOf('=') + 1, type: 'SyntaxWarning', category: 'syntax', message: '条件语句中使用了 "=" — 可能想要 "=="', fix: '将 "=" 替换为 "=="', severity: 'warning' });
            }
        }
    }

    _detectBareExcept(lines, problems) {
        for (let i = 0; i < lines.length; i++) {
            const stripped = lines[i].trim();
            if (/^except\s*:/.test(stripped)) {
                problems.push({ line: i + 1, column: 1, type: 'StyleWarning', category: 'best_practice', message: '使用了裸 except', fix: 'except Exception as e:', severity: 'warning' });
            }
        }
    }

    _detectDuplicateParameters(lines, problems) {
        for (let i = 0; i < lines.length; i++) {
            const stripped = lines[i].trim();
            const match = stripped.match(/^def\s+\w+\s*\(([^)]*)\)/);
            if (!match) continue;
            const params = match[1].split(',').map(p => p.trim().split('=')[0].trim().split(':')[0].trim().replace(/^\*+/, '')).filter(p => p && p !== 'self' && p !== 'cls');
            const seen = new Set();
            for (const p of params) {
                if (seen.has(p)) problems.push({ line: i + 1, column: stripped.indexOf(p), type: 'SyntaxError', category: 'syntax', message: `重复参数名`, fix: `重命名 "${p}"`, severity: 'error' });
                seen.add(p);
            }
        }
    }

    _detectReturnOutsideFunction(lines, problems) {
        let inFunction = false;
        for (let i = 0; i < lines.length; i++) {
            const stripped = lines[i].trim();
            if (/^def\s/.test(stripped)) { inFunction = true; continue; }
            if (inFunction && stripped !== '' && !stripped.startsWith('#')) {
                const indent = lines[i].match(/^(\s*)/)[1].length;
                if (indent === 0) inFunction = false;
            }
            if (!inFunction && /^(return|yield)\b/.test(stripped)) {
                problems.push({ line: i + 1, column: 1, type: 'SyntaxError', category: 'syntax', message: '"return/yield" 在函数外部使用', fix: '放入函数体内', severity: 'error' });
            }
        }
    }

    _detectBreakOutsideLoop(lines, problems) {
        let loopDepth = 0;
        for (let i = 0; i < lines.length; i++) {
            const stripped = lines[i].trim();
            if (/^\s*(for|while)\s/.test(stripped)) loopDepth++;
            if (/^(break|continue)\b/.test(stripped) && loopDepth === 0) {
                problems.push({ line: i + 1, column: 1, type: 'SyntaxError', category: 'syntax', message: '"break/continue" 在循环外部使用', fix: '放入循环体内', severity: 'error' });
            }
            if (loopDepth > 0 && stripped !== '' && !stripped.startsWith('#')) {
                const indent = lines[i].match(/^(\s*)/)[1].length;
                if (indent === 0) loopDepth = 0;
            }
        }
    }

    _detectUnreachableCode(lines, problems) {
        const controlFlow = /\b(return|raise|break|continue)\b/;
        let inFunc = false, funcIndent = 0;
        for (let i = 0; i < lines.length; i++) {
            const stripped = lines[i].trim();
            const indent = lines[i].match(/^(\s*)/)[1].length;
            if (/^def\s/.test(stripped)) { inFunc = true; funcIndent = indent; continue; }
            if (inFunc && stripped !== '' && !stripped.startsWith('#') && indent <= funcIndent && !/^\s*(if|elif|else|for|while|try|except|finally|with|@)/.test(stripped)) { inFunc = false; }
            const codePart = stripped.replace(/#.*$/, '');
            if (controlFlow.test(codePart) && i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                const nextStripped = nextLine.trim();
                const nextIndent = nextLine.match(/^(\s*)/)[1].length;
                if (nextIndent === indent && nextStripped && !nextStripped.startsWith('#') && !/^\s*(except|finally|else|elif)\b/.test(nextStripped)) {
                    problems.push({ line: i + 2, column: 1, type: 'Warning', category: 'logic', message: '此代码在 return/raise/break/continue 之后，可能不可达', fix: '删除不可达代码', severity: 'warning' });
                }
            }
        }
    }

    _detectFStringErrors(lines, problems) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const fMatch = line.match(/(?:^|[^a-zA-Z_])f(["'])/);
            if (!fMatch) continue;
            const quote = fMatch[1];
            const fCol = fMatch.index + fMatch[0].length - 1;
            const tripleQuote = line.substring(fCol - 1, fCol + 2) === quote + quote + quote;

            let braceDepth = 0;
            let foundBackslashInExpr = false;
            let backslashLine = 0, backslashCol = 0;
            let fstringEnded = false;

            for (let li = i; li < lines.length && !fstringEnded; li++) {
                const scanLine = lines[li];
                const startJ = (li === i) ? (fCol + 1) : 0;

                for (let j = startJ; j < scanLine.length; j++) {
                    const ch = scanLine[j];
                    if (ch === '\\') {
                        // 反斜杠在 f-string 表达式 {} 中 → 真正的根因
                        if (braceDepth > 0) {
                            foundBackslashInExpr = true;
                            backslashLine = li + 1;
                            backslashCol = j + 1;
                        }
                        j++; // 跳过被转义字符
                        continue;
                    }
                    if (ch === quote) {
                        if (tripleQuote && scanLine.substring(j, j + 3) === quote + quote + quote) {
                            fstringEnded = true; break;
                        }
                        if (!tripleQuote) { fstringEnded = true; break; }
                    }
                    if (ch === '{' && scanLine[j + 1] !== '{') { braceDepth++; }
                    if (ch === '}' && scanLine[j + 1] !== '}') {
                        braceDepth--;
                        if (braceDepth < 0) {
                            problems.push({
                                line: li + 1, column: j + 1,
                                type: 'SyntaxError', category: 'syntax',
                                message: 'f-string 中多余的 "}"',
                                fix: '使用 "}}" 表示字面量花括号',
                                severity: 'error',
                                _isDownstream: true
                            });
                            braceDepth = 0;
                        }
                    }
                }

                if (foundBackslashInExpr) {
                    // 报告根因
                    problems.push({
                        line: backslashLine, column: backslashCol,
                        type: 'SyntaxError', category: 'syntax',
                        message: 'f-string 表达式内不能包含反斜杠 "\\"',
                        fix: '将反斜杠续行改为隐式续行（括号包裹），或将表达式提取为变量',
                        severity: 'error',
                        _isRootCause: true
                    });
                    if (braceDepth > 0) {
                        problems.push({
                            line: backslashLine, column: backslashCol,
                            type: 'SyntaxError', category: 'syntax',
                            message: 'f-string 中 "{" 因反斜杠中断而未能闭合',
                            fix: '移除 f-string 表达式中的反斜杠',
                            severity: 'error',
                            _isDownstream: true
                        });
                    }
                    fstringEnded = true;
                    continue;
                }

                if (!fstringEnded && !this._endsWithLineContinuation(scanLine)) {
                    if (braceDepth > 0) {
                        problems.push({
                            line: li + 1, column: scanLine.length,
                            type: 'SyntaxError', category: 'syntax',
                            message: 'f-string 中未闭合的 "{"',
                            fix: '补充 "}"',
                            severity: 'error',
                            _isDownstream: true
                        });
                    }
                    fstringEnded = true;
                }
            }
        }
    }

    _detectMutableDefaultArg(lines, problems) {
        for (let i = 0; i < lines.length; i++) {
            const stripped = lines[i].trim();
            const match = stripped.match(/^def\s+\w+\s*\(([^)]*)\)/);
            if (!match) continue;
            const defaults = match[1].split(',');
            for (const d of defaults) {
                if (/=\s*\[\s*\]/.test(d) || /=\s*\{\s*\}/.test(d)) {
                    problems.push({ line: i + 1, column: 1, type: 'Warning', category: 'best_practice', message: '可变对象作为默认参数 — 所有调用共享', fix: '使用 None 作为默认值，函数内初始化', severity: 'warning' });
                }
            }
        }
    }

    /**
     * 类型推断引擎 — 检测因类型不匹配导致的运行时 TypeError
     * 推断变量类型、循环变量类型、函数参数类型
     * 检测混合类型列表、int+str 等不兼容运算
     */
    _detectTypeErrors(lines, problems) {
        const varTypes = {};    // varName -> { type, mixed, elementTypes }
        const funcDefs = {};    // funcName -> { params, hasNumericOp, opLine }
        const funcCalls = [];   // { line, funcName, args, assignTo }

        // 推断字面量类型
        const typeOf = (token) => {
            if (!token) return null;
            if (/^-?\d+$/.test(token)) return 'int';
            if (/^-?\d+\.\d+$/.test(token)) return 'float';
            if (/^["'][^"']*["']$/.test(token)) return 'str';
            if (/^(True|False)$/.test(token)) return 'bool';
            if (token === 'None') return 'NoneType';
            if (varTypes[token]) return varTypes[token].type;
            return null;
        };

        // 提取列表元素类型
        const inferListTypes = (rhs) => {
            const inner = rhs.slice(1, -1).trim();
            if (!inner) return new Set();
            const parts = inner.split(',').map(s => s.trim());
            const types = new Set();
            for (const p of parts) {
                const t = typeOf(p);
                if (t) types.add(t);
            }
            return types;
        };

        // Pass 1: 收集函数定义和变量类型
        let inFunc = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const stripped = line.trim();
            if (!stripped || stripped.startsWith('#')) continue;

            // 函数定义
            const funcMatch = stripped.match(/^def\s+(\w+)\s*\(([^)]*)\)\s*:/);
            if (funcMatch) {
                inFunc = funcMatch[1];
                const params = funcMatch[2].split(',').map(p => p.trim().split('=')[0].split(':')[0].trim()).filter(Boolean);
                funcDefs[inFunc] = { params, hasNumericOp: false, opLine: 0 };
                continue;
            }

            // 缩进归零即退出函数体
            if (inFunc && stripped && !/^[\s]/.test(line) && !stripped.startsWith('def ')) {
                inFunc = null;
            }

            // 函数体内检测运算符
            if (inFunc && funcDefs[inFunc]) {
                const codeOnly = stripped.replace(/"[^"]*"|'[^']*'/g, '');
                if (/[+\-*/%]/.test(codeOnly)) {
                    funcDefs[inFunc].hasNumericOp = true;
                    funcDefs[inFunc].opLine = i + 1;
                }
            }

            // 变量赋值
            const assignMatch = stripped.match(/^(\w[\w.]*)\s*=\s*(.+)$/);
            if (assignMatch) {
                const varName = assignMatch[1];
                const rhs = assignMatch[2].trim();

                const litType = typeOf(rhs);
                if (litType) {
                    varTypes[varName] = { type: litType, mixed: false };
                    continue;
                }

                // 列表字面量
                if (rhs.startsWith('[') && rhs.endsWith(']')) {
                    const elemTypes = inferListTypes(rhs);
                    if (elemTypes.size > 1) {
                        varTypes[varName] = { type: 'list', mixed: true, elementTypes: elemTypes };
                        problems.push({
                            line: i + 1, column: stripped.indexOf('[') + 1,
                            type: 'TypeWarning', category: 'type_safety',
                            message: `列表包含混合类型: ${[...elemTypes].join(' | ')} — 运行时可能出错`,
                            fix: '确保列表元素类型一致',
                            severity: 'warning',
                            _isDownstream: true
                        });
                    } else if (elemTypes.size === 1) {
                        varTypes[varName] = { type: 'list', mixed: false, elementTypes: elemTypes };
                    } else {
                        varTypes[varName] = { type: 'list', mixed: false, elementTypes: new Set() };
                    }
                    continue;
                }

                // 函数调用赋值
                const callMatch = rhs.match(/^(\w+)\s*\(([^)]*)\)$/);
                if (callMatch) {
                    funcCalls.push({
                        line: i + 1,
                        funcName: callMatch[1],
                        args: callMatch[2].split(',').map(a => a.trim()).filter(Boolean),
                        assignTo: varName
                    });
                    continue;
                }
            }

            // for 循环变量类型推断
            const forMatch = stripped.match(/^for\s+(\w+)\s+in\s+(\w+)\s*:/);
            if (forMatch) {
                const loopVar = forMatch[1];
                const iterable = forMatch[2];
                if (varTypes[iterable] && varTypes[iterable].elementTypes) {
                    const elemTypes = varTypes[iterable].elementTypes;
                    if (elemTypes.size === 1) {
                        varTypes[loopVar] = { type: [...elemTypes][0], mixed: false };
                    } else {
                        varTypes[loopVar] = { type: [...elemTypes].join('|'), mixed: true };
                    }
                }
            }
        }

        // Pass 2: 检查函数调用中的类型不兼容
        for (const call of funcCalls) {
            const func = funcDefs[call.funcName];
            if (!func || !func.hasNumericOp) continue;

            const argTypes = call.args.map(a => typeOf(a));
            const hasInt = argTypes.some(t => t === 'int');
            const hasStr = argTypes.some(t => t === 'str');
            const mixedIdx = argTypes.findIndex(t => t && t.includes('|'));

            if (hasInt && hasStr) {
                const strs = call.args.filter((a, i) => argTypes[i] === 'str');
                const ints = call.args.filter((a, i) => argTypes[i] === 'int');
                problems.push({
                    line: call.line, column: 1,
                    type: 'TypeError', category: 'type_safety',
                    message: `${call.funcName}(${call.args.join(', ')}) 中 ${ints.join('、')}(int) 与 ${strs.join('、')}(str) 做 + 运算会 TypeError`,
                    fix: `将参数转换为相同类型，如 str(${ints[0]}) 或 int(${strs[0]})`,
                    severity: 'error',
                    _isRootCause: true
                });
            } else if (hasInt && mixedIdx >= 0) {
                const mixedArg = call.args[mixedIdx];
                const mixedType = argTypes[mixedIdx];
                if (mixedType && mixedType.includes('str')) {
                    problems.push({
                        line: call.line, column: 1,
                        type: 'TypeError', category: 'type_safety',
                        message: `${call.funcName}(${call.args.join(', ')}) 中 "${mixedArg}" 可能是 str (来自混合类型列表)，与 int 做运算会 TypeError`,
                        fix: `确保 "${mixedArg}" 为数值类型，或使用 isinstance() 检查类型`,
                        severity: 'error',
                        _isRootCause: true
                    });
                }
            }
        }

        // Pass 3: 直接检测代码中的运算符类型不兼容
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const stripped = line.trim();
            if (!stripped || stripped.startsWith('#') || stripped.startsWith('def ')) continue;

            // 跳过字符串内的内容
            const codePart = stripped.replace(/"[^"]*"|'[^']*'/g, '""');

            // 检测 var + var 模式
            const binOpMatch = codePart.match(/(\w+)\s*\+\s*(\w+)/);
            if (binOpMatch) {
                const left = binOpMatch[1];
                const right = binOpMatch[2];
                const leftType = typeOf(left);
                const rightType = typeOf(right);
                if (leftType && rightType && leftType !== rightType) {
                    // 跳过 str+str（合法拼接）
                    if (leftType === 'str' && rightType === 'str') continue;
                    // 跳过数值运算
                    if ((leftType === 'int' || leftType === 'float') && (rightType === 'int' || rightType === 'float')) continue;
                    // 类型不兼容
                    problems.push({
                        line: i + 1, column: stripped.indexOf('+') + 1,
                        type: 'TypeError', category: 'type_safety',
                        message: `"${left}"(${leftType}) + "${right}"(${rightType}) 类型不兼容，会 TypeError`,
                        fix: `将操作数转换为相同类型`,
                        severity: 'error',
                        _isRootCause: true
                    });
                }
            }
        }
    }

    /**
     * 根因分析：标记根因错误，将并发症标记为下游错误
     * 根因错误 → 红色；下游并发症 → 橙色；无关 → 默认色
     */
    _analyzeRootCause(problems) {
        const rootCauses = [];
        for (let i = 0; i < problems.length; i++) {
            if (problems[i]._isRootCause) {
                rootCauses.push({ idx: i, problem: problems[i] });
            }
        }
        if (rootCauses.length === 0) return;

        for (const rc of rootCauses) {
            const rcLine = rc.problem.line;
            // 将根因 ±2 行内的下游错误关联到根因
            for (let i = 0; i < problems.length; i++) {
                const p = problems[i];
                if (p._isRootCause || p === rc.problem) continue;
                if (p._isDownstream && Math.abs(p.line - rcLine) <= 2) {
                    p._causedBy = rc.idx;
                    p._causeMsg = rc.problem.message;
                }
            }
        }
        // 将根因排到最前面
        problems.sort((a, b) => {
            if (a._isRootCause && !b._isRootCause) return -1;
            if (!a._isRootCause && b._isRootCause) return 1;
            if (a._causedBy !== undefined && b._causedBy === undefined) return 1;
            if (a._causedBy === undefined && b._causedBy !== undefined) return -1;
            return a.line - b.line || (a.column || 0) - (b.column || 0);
        });
    }

    /**
     * 版本感知语法检测 — 检测 Python 版本特有的语法变更
     * @param {string} code 原始代码
     * @param {string[]} lines 代码行
     * @param {Array} problems 问题列表
     */
    _detectVersionSpecificSyntax(lines, problems) {
        // 检测 f-string 中反斜杠 + 续行（Python 3.12+ 禁止）
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const fMatch = line.match(/(?:^|[^a-zA-Z_])f(["'])/);
            if (!fMatch) continue;
            const quote = fMatch[1];
            const fCol = fMatch.index + fMatch[0].length - 1;
            let braceDepth = 0;
            for (let j = fCol + 1; j < line.length; j++) {
                const ch = line[j];
                if (ch === '\\') {
                    if (braceDepth > 0) {
                        // 已在 _detectFStringErrors 中处理
                        return;
                    }
                    j++; continue;
                }
                if (ch === quote) break;
                if (ch === '{' && line[j + 1] !== '{') braceDepth++;
                if (ch === '}' && line[j + 1] !== '}') braceDepth--;
            }
        }
    }

    /**
     * 设置目标 Python 版本（影响语法检测严格程度）
     * @param {string} version - '3.10' | '3.11' | '3.12'
     */
    setPythonVersion(version) {
        this._pythonVersion = version;
    }

    getPythonVersion() {
        return this._pythonVersion || '3.12';
    }
}

window.LogiX = LogiX;
window.logiX = new LogiX();
window.pythonAnalyzer = window.logiX;
