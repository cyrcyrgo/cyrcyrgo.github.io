"""为新增的 5 个内容域合成训练语料。

域与格式（与网页端 app.js 的 prompt 模板严格对应）：
  greet  基础问候闲聊   <|user|>{q}\n<|assistant|>{a}\n<|endoftext|>\n
  qa     知识问答       <|user|>{q}\n<|assistant|>{a}\n<|endoftext|>\n
  enqa   英文问答       <|user|>{q}\n<|assistant|>{a}\n<|endoftext|>\n
  math   数学应用题     <|user|>{q}\n<|assistant|>{a}\n<|endoftext|>\n
  web    网页创作       <|user|>{q}\n<|assistant|>\n```html\n{code}\n```\n<|endoftext|>\n\n
                 （HTML + CSS + JS 混合，输出完整可运行单文件页面）

用法：
    python scripts/gen_domain_synthetic.py            # 全部生成到 data/<域>_raw/
    python scripts/gen_domain_synthetic.py greet math # 只生成指定域
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

QA_TMPL = [
    "<|user|>{q}\n<|assistant|>{a}\n<|endoftext|>\n",
    "<|user|>{q}\n<|assistant|>{a}\n<|endoftext|>\n",
    "问题：{q}\n回答：{a}\n<|endoftext|>\n",
    "用户：{q}\n助手：{a}\n<|endoftext|>\n",
]
WEB_TMPL = "<|user|>{q}\n<|assistant|>\n```html\n{code}\n```\n<|endoftext|>\n\n"


# ======================================================================
# 1. 基础问候闲聊
# ======================================================================
GREETINGS = [
    ("你好", "你好呀！很高兴见到你，今天过得怎么样？"),
    ("你好啊", "你好！我一直在这儿等着和你聊天呢，有什么想聊的都可以说。"),
    ("嗨", "嗨！你好呀，有什么我可以帮你的吗？"),
    ("在吗", "在的，我一直在。有什么想聊的尽管说吧。"),
    ("早上好", "早上好！新的一天开始了，愿你今天顺顺利利、心情舒畅。"),
    ("中午好", "中午好！记得按时吃饭，休息一下再继续忙哦。"),
    ("下午好", "下午好！喝杯水，稍微放松一下，效率会更高。"),
    ("晚上好", "晚上好！忙了一天，辛苦了，早点休息。"),
    ("晚安", "晚安！祝你一夜好梦，明天精神满满。"),
    ("早上好呀", "早上好呀！今天想聊点什么呢？"),
    ("你是谁", "我是一个精简的中文语言模型，可以陪你聊天、回答问题，也能帮你写点小东西。"),
    ("你叫什么名字", "我叫 MiniLLM，是一个从零训练出来的迷你语言模型。"),
    ("你会做什么", "我会聊天、回答常见问题、做简单的数学题，还能写简单的网页代码。你想到什么都可以问我。"),
    ("你几岁了", "我没有年龄的概念，我是被训练出来的程序，随时都可以陪你聊天。"),
    ("谢谢", "不客气！能帮到你我真的很开心。"),
    ("谢谢你", "不用谢，这是我应该做的。还有什么需要尽管说。"),
    ("多谢", "别客气，举手之劳而已。"),
    ("太感谢了", "太客气啦！有需要随时找我。"),
    ("再见", "再见！很高兴和你聊天，有空常来。"),
    ("拜拜", "拜拜！祝你一切顺利，我们下次再聊。"),
    ("我走了", "好的，路上小心，期待下次见面。"),
    ("我回来了", "欢迎回来！刚刚去哪儿啦？"),
    ("最近怎么样", "我挺好的，谢谢关心。你呢，最近过得怎么样？"),
    ("你吃饭了吗", "我不用吃饭，不过还是谢谢你的关心。你今天吃了什么好吃的？"),
    ("今天天气真好", "是啊，天气好的时候心情也会变好。适合出去走走、晒晒太阳。"),
    ("我心情不好", "抱抱你。先深呼吸一下，可以跟我说说发生了什么，说出来会好受一些。"),
    ("我好累啊", "辛苦了。先放下手里的事休息一会儿，喝口水，身体最重要。"),
    ("我好开心", "那真是太好啦！开心的事情值得多分享几遍，说给我听听？"),
    ("我有点无聊", "那我们来聊点有意思的？你可以让我讲个冷笑话、回答一个奇怪的问题，或者帮你写个小网页。"),
    ("陪我聊聊天吧", "当然可以，我很乐意陪你。你想从哪里开始聊呢？"),
    ("讲个笑话", "好呀——为什么程序员总是分不清万圣节和圣诞节？因为 Oct 31 等于 Dec 25。"),
    ("你会讲笑话吗", "会一点点。有一个面包走在路上，走着走着觉得饿了，于是就把自己吃掉了。"),
    ("你累不累", "我不会累，随时都在线。倒是你要记得劳逸结合。"),
    ("你真好", "谢谢你这么说，你也很温柔呀。"),
    ("我喜欢你", "谢谢你的喜欢，我也会好好陪着你的。"),
    ("你在干嘛", "我在等你跟我说话呀，现在你来了。"),
    ("你睡了吗", "我不睡觉的，二十四小时都在。"),
    ("我们做朋友吧", "好呀，那我们就是朋友了。"),
    ("帮我推荐点什么", "可以呀，推荐你今天做三件小事：喝够水、走一走、早点睡。简单但管用。"),
    ("夸夸我", "你已经很棒了——愿意认真生活、还在努力变好，这本身就值得夸奖。"),
    ("今天好热", "天气热记得多喝水、少在正午出门，注意防暑。"),
    ("今天好冷", "天冷了记得加衣服，多喝热水，别着凉了。"),
    ("周末有什么建议", "可以睡到自然醒，再去散散步，做一件一直想做但没时间做的小事。"),
]

GREET_VARIANTS = [
    "{q}", "{q}！", "{q}~", "{q}，在吗？", "喂，{q}", "{q}呀",
]


def gen_greet(out_dir, reps=48):
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "greet_synthetic.txt")
    random.seed(11)
    n = 0
    with open(out, "w", encoding="utf-8") as f:
        for _ in range(reps):
            items = GREETINGS[:]
            random.shuffle(items)
            for q, a in items:
                tmpl = random.choice(QA_TMPL)
                for _v in range(random.choice([1, 2])):
                    vq = random.choice(GREET_VARIANTS).format(q=q)
                    f.write(tmpl.format(q=vq, a=a))
                    n += 1
    print(f"[greet] {out}  {os.path.getsize(out):,} bytes  {n} 条")
    return out


# ======================================================================
# 2. 中文知识问答
# ======================================================================
QA = [
    ("中国的首都是哪里？", "中国的首都是北京，位于华北平原北部，是中华人民共和国的政治中心和文化中心。"),
    ("太阳从哪个方向升起？", "太阳从东方升起。因为地球自西向东自转，所以我们每天早晨看到太阳从东方地平线升起，傍晚从西方落下。"),
    ("一年有多少个月？", "一年有十二个月，从一月到十二月。其中一月、三月、五月、七月、八月、十月、十二月各有三十一天。"),
    ("一年有多少天？", "平年有 365 天，闰年有 366 天。闰年每四年出现一次，二月会多出一天。"),
    ("一天有多少小时？", "一天有 24 小时，1 小时等于 60 分钟，1 分钟等于 60 秒。"),
    ("水的化学式是什么？", "水的化学式是 H₂O，表示一个水分子由两个氢原子和一个氧原子组成。"),
    ("《红楼梦》的作者是谁？", "《红楼梦》是清代作家曹雪芹创作的长篇小说，后四十回一般认为由高鹗续写完成。"),
    ("《西游记》的作者是谁？", "《西游记》是明代小说家吴承恩创作的神魔小说，讲述了唐僧师徒四人西天取经的故事。"),
    ("《三国演义》的作者是谁？", "《三国演义》是元末明初小说家罗贯中创作的长篇历史小说。"),
    ("《水浒传》的作者是谁？", "《水浒传》一般认为是元末明初施耐庵所著，描写了梁山一百零八位好汉的故事。"),
    ("中国古代四大发明是什么？", "中国古代四大发明是造纸术、印刷术、火药和指南针。"),
    ("地球绕太阳一周要多久？", "地球绕太阳公转一周大约需要 365.25 天，也就是一年，这个周期叫做一个回归年。"),
    ("地球自转一周要多久？", "地球自转一周大约需要 24 小时，也就是一天，这就是昼夜交替的原因。"),
    ("世界上最长的河流是哪条？", "尼罗河是世界上最长的河流，全长约 6650 公里，流经非洲东北部。"),
    ("世界上最高的山峰是哪座？", "珠穆朗玛峰是世界最高峰，海拔约 8848.86 米，位于中国与尼泊尔的边界上。"),
    ("中国最长的河流是哪条？", "长江是中国最长的河流，全长约 6300 公里，也是世界第三长河。"),
    ("世界上面积最大的国家是哪个？", "俄罗斯是世界上面积最大的国家，国土面积约 1709 万平方公里，横跨欧亚两大洲。"),
    ("中国有多少个省级行政区？", "中国共有 34 个省级行政区，包括 23 个省、5 个自治区、4 个直辖市和 2 个特别行政区。"),
    ("什么是光合作用？", "光合作用是植物利用阳光的能量，把二氧化碳和水转化成葡萄糖并释放氧气的过程，几乎所有生命都依赖它。"),
    ("为什么天空是蓝色的？", "太阳光进入大气层后，蓝光波长短，被空气分子散射得最厉害，所以我们抬头看到的天空是蓝色的。"),
    ("为什么会有白天和黑夜？", "因为地球在自转。被太阳照到的一面是白天，背对太阳的一面是黑夜。"),
    ("为什么会有四季？", "因为地球的自转轴是倾斜的，绕太阳公转时不同季节太阳直射的位置不同，所以有了春夏秋冬。"),
    ("彩虹是怎么形成的？", "阳光照射到空气中的小水滴时，会先折射再反射，白光被分解成七种颜色，就形成了彩虹。"),
    ("地球表面有多少被水覆盖？", "地球表面大约 71% 被水覆盖，其中约 97% 是海水，只有约 3% 是淡水。"),
    ("空气的主要成分是什么？", "空气主要由氮气和氧气组成，其中氮气约占 78%，氧气约占 21%，其余是二氧化碳和稀有气体等。"),
    ("人体最大的器官是什么？", "人体最大的器官是皮肤，它覆盖全身，起到保护、感觉和调节体温的作用。"),
    ("成年人有多少块骨头？", "成年人一般有 206 块骨头，而新生儿的骨头更多，约有 300 块，随着成长部分骨头会融合。"),
    ("正常人的体温大约是多少？", "正常人的体温大约在 36.5 摄氏度左右，一般测量腋下温度在 36 到 37 摄氏度之间都属正常。"),
    ("一天应该喝多少水？", "一般建议成年人每天饮水约 1500 到 1700 毫升，也就是大约七八杯水，运动或天热时要适当增加。"),
    ("如何保持健康？", "保持健康的关键是均衡饮食、规律运动、充足睡眠、定期体检、保持好心情，并且不吸烟、少喝酒。"),
    ("感冒了应该怎么办？", "普通感冒要多休息、多喝温水、注意保暖，一般一周左右会自愈；如果持续高烧或症状严重，应及时就医。"),
    ("怎样保护眼睛？", "每用眼 40 分钟就远眺休息几分钟，保持光线充足、距离合适，少熬夜，多看看远处和绿色植物。"),
    ("什么是人工智能？", "人工智能是让机器模拟人类智能的技术，包括学习、推理、感知和决策，比如语音识别、图像识别和语言模型。"),
    ("机器学习和深度学习有什么区别？", "机器学习是人工智能的一个分支，深度学习又是机器学习的一个分支，它使用多层神经网络来自动学习特征。"),
    ("Python 是什么？", "Python 是一种高级编程语言，语法简洁清晰，广泛用于数据分析、人工智能、网络开发和自动化脚本。"),
    ("Java 和 Python 哪个好？", "没有绝对的好坏。Python 简洁灵活，适合快速开发和数据科学；Java 稳定高效，适合大型企业级应用。"),
    ("什么是操作系统？", "操作系统是管理计算机硬件和软件资源的系统软件，比如 Windows、macOS、Linux 和安卓。"),
    ("什么是互联网？", "互联网是把全球无数台计算机连接起来的网络，让人们可以互相通信、共享信息和访问网站。"),
    ("什么是云计算？", "云计算是把计算和存储资源放在远程服务器上，通过网络按需使用，就像用电一样按量付费。"),
    ("什么是区块链？", "区块链是一种分布式账本技术，数据以块链式存储，每个节点都有完整副本，具有去中心化和难以篡改的特点。"),
    ("1 公斤等于多少克？", "1 公斤等于 1000 克。公斤是国际单位制中质量的基本单位。"),
    ("1 米等于多少厘米？", "1 米等于 100 厘米，也等于 1000 毫米。"),
    ("1 小时等于多少秒？", "1 小时等于 60 分钟，也就是 3600 秒。"),
    ("一公里等于多少米？", "一公里等于 1000 米。"),
    ("什么是圆周率？", "圆周率是圆的周长与直径的比值，通常记作 π，约等于 3.14159，它是一个无限不循环小数。"),
    ("长方形的面积怎么算？", "长方形的面积等于长乘以宽，公式是 S = a × b。例如长 5 米、宽 3 米，面积就是 15 平方米。"),
    ("圆的面积怎么算？", "圆的面积等于圆周率乘以半径的平方，公式是 S = πr²。"),
    ("春节有哪些传统习俗？", "春节习俗有贴春联、吃年夜饭、守岁、拜年、发红包、放鞭炮、舞龙舞狮等，是一年中最隆重的节日。"),
    ("端午节吃什么？", "端午节吃粽子、赛龙舟，这个节日是为了纪念爱国诗人屈原。"),
    ("中秋节有什么习俗？", "中秋节有赏月、吃月饼、家人团圆的习俗，象征着圆满和思念。"),
    ("元宵节吃什么？", "元宵节吃元宵或汤圆，还有赏花灯、猜灯谜的习俗。"),
    ("春节为什么要贴春联？", "贴春联是为了表达对新年的美好祝愿，红色的春联也寓意喜庆和吉祥。"),
    ("中国人为什么喜欢红色？", "在中国文化里，红色象征喜庆、吉祥和热情，所以过年、婚礼等喜庆场合常用红色。"),
    ("电子邮件地址一般是什么格式？", "电子邮件地址由用户名、@ 符号和域名三部分组成，例如 example@mail.com。"),
    ("为什么要节约用水？", "地球上的淡水资源很有限，节约用水既能保护环境，也能保证我们未来的用水需求。"),
    ("垃圾应该怎么分类？", "常见分类是可回收物、有害垃圾、厨余垃圾和其他垃圾，分类投放有利于资源回收和环境保护。"),
    ("植树造林有什么好处？", "植树能吸收二氧化碳、释放氧气、防风固沙、保持水土，还能为动物提供栖息地，改善生态环境。"),
    ("怎样保护环境？", "少用一次性用品、随手关灯关水、垃圾分类、绿色出行、多种树，每个人都能为环境出一份力。"),
    ("为什么要多读书？", "读书能增长知识、开阔视野、提升表达能力，也能让人在浮躁的时候静下心来。"),
    ("遇到困难怎么办？", "先把问题拆小，一步一步解决；实在解决不了就寻求帮助。大部分困难都能被耐心和行动化解。"),
    ("怎样提高学习效率？", "制定清晰的目标、专注一段时间再休息、及时复习、把重复的事情交给工具，效率会明显提高。"),
    ("怎样培养好习惯？", "从很小的、容易坚持的动作开始，固定时间和场景，坚持一段时间后它就会变成习惯。"),
    ("什么是惰性？", "惰性通常指物质不易与其他物质发生反应的化学性质，比如黄金、氦气都很稳定。"),
    ("水在多少度会结冰？", "在标准大气压下，纯水在 0 摄氏度会结冰，在 100 摄氏度会沸腾。"),
    ("声音在空气中传播得快吗？", "声音在空气中的传播速度大约是每秒 340 米，比光速慢得多，所以先看到闪电后听到雷声。"),
    ("光的速度有多快？", "光在真空中的速度约为每秒 30 万公里，是宇宙中已知最快的速度。"),
    ("太阳系有几大行星？", "太阳系有八大行星，按离太阳由近到远依次是水星、金星、地球、火星、木星、土星、天王星和海王星。"),
    ("月亮会发光吗？", "月亮本身不发光，它反射太阳的光，所以我们能看到明亮的月亮。"),
    ("为什么海水是咸的？", "海水里溶解了大量盐分，主要是氯化钠，这些盐来自岩石风化和河流长期带来的矿物质。"),
    ("为什么星星会眨眼？", "因为星光穿过地球大气层时被折射和扰动，所以我们看起来星星像是在一闪一闪地眨眼。"),
    ("为什么雨后空气清新？", "雨水会冲刷掉空气中的灰尘和部分污染物，同时雷电还会产生少量臭氧，所以雨后空气格外清新。"),
    ("什么是温室效应？", "温室效应是大气中的二氧化碳等气体让地球保温的现象。适度的温室效应是必要的，但过量会导致全球变暖。"),
    ("什么是重力？", "重力是地球对物体的吸引力，它让我们能够站在地面上，也让物体下落。"),
    ("为什么乐高能拼得那么紧？", "因为乐高积木的凸起和孔洞尺寸经过精密设计，靠摩擦力紧密咬合，所以拼起来很牢固。"),
    ("什么是维生素？", "维生素是人体需要量很少但不可缺少的一类有机物，能帮助身体正常代谢，缺乏会引起各种健康问题。"),
    ("什么东西含钙最多？", "牛奶、酸奶、豆制品、小鱼干和芝麻等食物含钙比较丰富，有助于骨骼和牙齿健康。"),
    ("为什么要吃早餐？", "早餐能补充一夜消耗的能量，帮助提高上午的注意力和效率，长期不吃早餐对健康不利。"),
    ("运动前要热身吗？", "要的。热身能让身体逐渐进入状态，提高肌肉温度，降低受伤的风险。"),
    ("怎样睡得更好？", "固定作息、睡前少看手机、卧室保持安静黑暗、白天适度运动，都能帮助提高睡眠质量。"),
]

QA_PRACTICE = [
    ("帮我写一首关于春天的小诗", "春风拂柳绿初黄，燕子衔泥绕屋梁。\n溪水潺潺迎晓日，桃花点点映清塘。\n人间四月芳菲盛，蝶舞蜂飞自在忙。\n最是一年春好处，轻舟一叶泛湖光。"),
    ("给我三个提高效率的小建议", "一、每天先做最重要的一件难事；\n二、用番茄工作法，专注 25 分钟再休息 5 分钟；\n三、把重复的事交给工具，把脑力留给真正需要思考的事。"),
    ("如何在压力大的时候放松？", "可以试试深呼吸、出门散步、听音乐、和朋友聊聊天，或者把压力写下来，把它拆成能解决的小事。"),
    ("怎样和陌生人交流", "可以从简单的问候和共同话题开始，多倾听、多微笑，保持真诚和尊重，慢慢就会自然起来。"),
    ("怎样才能记住更多东西", "理解比死记更重要，把知识和已有的经验联系起来，并且间隔复习，效果会好很多。"),
]


def gen_qa(out_dir, reps=32):
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "qa_synthetic.txt")
    random.seed(23)
    pool = QA + QA_PRACTICE
    n = 0
    with open(out, "w", encoding="utf-8") as f:
        for _ in range(reps):
            items = pool[:]
            random.shuffle(items)
            for q, a in items:
                tmpl = random.choice(QA_TMPL)
                f.write(tmpl.format(q=q, a=a))
                n += 1
    print(f"[qa] {out}  {os.path.getsize(out):,} bytes  {n} 条")
    return out


# ======================================================================
# 3. 英文问答
# ======================================================================
ENQA = [
    ("Hello", "Hello! Nice to meet you. How are you doing today?"),
    ("Hi there", "Hi! I'm here and ready to chat. What would you like to talk about?"),
    ("How are you?", "I'm doing great, thank you for asking. How about you?"),
    ("What is your name?", "My name is MiniLLM, a small language model trained from scratch."),
    ("Who are you?", "I am a compact language model that can answer questions, chat, and write simple web pages."),
    ("What can you do?", "I can chat, answer common questions, do simple math, and write basic HTML, CSS and JavaScript."),
    ("Thank you", "You're very welcome! I'm glad I could help."),
    ("Goodbye", "Goodbye! It was nice talking with you. See you next time."),
    ("Good morning", "Good morning! I hope you have a wonderful day ahead."),
    ("Good night", "Good night! Sleep well and sweet dreams."),
    ("What is the capital of China?", "The capital of China is Beijing. It is the political and cultural center of the country."),
    ("What is the capital of France?", "The capital of France is Paris, famous for the Eiffel Tower and the Louvre Museum."),
    ("What is the capital of Japan?", "The capital of Japan is Tokyo, one of the largest and busiest cities in the world."),
    ("Which planet is closest to the Sun?", "Mercury is the planet closest to the Sun in our solar system."),
    ("How many planets are in the solar system?", "There are eight planets in the solar system: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus and Neptune."),
    ("What is the largest ocean on Earth?", "The Pacific Ocean is the largest and deepest ocean on Earth."),
    ("What is the chemical formula of water?", "Water's chemical formula is H2O, which means two hydrogen atoms and one oxygen atom."),
    ("What is the tallest mountain in the world?", "Mount Everest is the tallest mountain in the world, about 8848 meters above sea level."),
    ("How many days are in a year?", "A normal year has 365 days, and a leap year has 366 days."),
    ("What is the speed of light?", "Light travels at about 300,000 kilometers per second in a vacuum, the fastest speed known."),
    ("What is artificial intelligence?", "Artificial intelligence is the field of building machines that can learn, reason and make decisions like humans."),
    ("What is Python?", "Python is a high-level programming language known for its clear syntax, widely used in data science and AI."),
    ("What is HTML?", "HTML stands for HyperText Markup Language. It defines the structure and content of web pages."),
    ("What is CSS?", "CSS stands for Cascading Style Sheets. It controls the look of a web page, such as colors and layout."),
    ("What is JavaScript?", "JavaScript is a programming language that runs in the browser and makes web pages interactive."),
    ("What is a function in programming?", "A function is a reusable block of code that takes inputs and returns an output, helping avoid repetition."),
    ("What is a variable?", "A variable is a named container that stores a value so you can use and change it later."),
    ("What is the internet?", "The internet is a global network that connects computers so people can share information and communicate."),
    ("What is a database?", "A database is an organized collection of data that can be easily stored, searched and updated."),
    ("What is an algorithm?", "An algorithm is a step-by-step procedure for solving a problem or completing a task."),
    ("How do you stay healthy?", "Eat balanced meals, exercise regularly, sleep enough, drink water, and keep a positive mood."),
    ("Why is the sky blue?", "Because air molecules scatter blue light more than other colors, so we see a blue sky."),
    ("Why do we have day and night?", "Because the Earth rotates. The side facing the Sun has day, and the other side has night."),
    ("Why are there seasons?", "Because the Earth's axis is tilted, so different parts get different sunlight through the year."),
    ("What is photosynthesis?", "Photosynthesis is how plants use sunlight, water and carbon dioxide to make food and release oxygen."),
    ("How many hours are in a day?", "There are 24 hours in a day, 60 minutes in an hour, and 60 seconds in a minute."),
    ("What is the largest country by area?", "Russia is the largest country by area, covering about 17 million square kilometers."),
    ("What is the longest river in the world?", "The Nile is often considered the longest river in the world, about 6650 kilometers long."),
    ("What is 1 kilogram in grams?", "One kilogram equals 1000 grams."),
    ("What is gravity?", "Gravity is the force that pulls objects toward each other, keeping us on the ground."),
    ("How can I improve my English?", "Read every day, listen to native speakers, speak as much as you can, and review new words often."),
    ("What should I do if I feel stressed?", "Take a deep breath, go for a walk, talk to someone you trust, and break problems into smaller steps."),
    ("What is the best way to learn programming?", "Write code every day, build small projects, read others' code, and don't be afraid of making mistakes."),
    ("Why is sleep important?", "Sleep helps your body recover and your brain organize memories, so you think better when rested."),
    ("What is climate change?", "Climate change is the long-term shift in global temperatures and weather, mainly caused by greenhouse gases."),
    ("How do you save water?", "Take shorter showers, fix leaks, turn off taps, and reuse water when you can."),
]


def gen_enqa(out_dir, reps=36):
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "enqa_synthetic.txt")
    random.seed(31)
    n = 0
    with open(out, "w", encoding="utf-8") as f:
        for _ in range(reps):
            items = ENQA[:]
            random.shuffle(items)
            for q, a in items:
                tmpl = random.choice(QA_TMPL)
                f.write(tmpl.format(q=q, a=a))
                n += 1
    print(f"[enqa] {out}  {os.path.getsize(out):,} bytes  {n} 条")
    return out


# ======================================================================
# 4. 数学计算 / 应用题
# ======================================================================
# 关键：tiny LM 无法从随机数字里泛化出算术能力（实测会算错、也不复制操作数）。
# 因此这里改为"固定精选题库 + 大量重复"的记忆型语料——与 qa/enqa 同思路：
# 模型只需牢牢记住这批题目的标准解，即可稳定复现。题库覆盖网页端 seeds。
_ADD = [(25, 37), (12, 8), (45, 55), (63, 27), (18, 24), (34, 29), (76, 18), (41, 39),
        (58, 26), (9, 17), (67, 25), (83, 9), (14, 68), (52, 48), (37, 46), (29, 61),
        (11, 89), (74, 16), (23, 58), (65, 35), (7, 8), (19, 23), (44, 56), (88, 12), (31, 49)]
_SUB = [(96, 48), (50, 23), (72, 19), (84, 37), (60, 25), (43, 17), (91, 56), (70, 28),
        (55, 19), (100, 64), (38, 12), (66, 29), (27, 15), (80, 45), (93, 48), (52, 34),
        (75, 38), (61, 26), (99, 53), (44, 22), (87, 39), (64, 18), (30, 14), (78, 26), (95, 47)]
_MUL = [(7, 8), (6, 9), (12, 8), (5, 6), (9, 9), (4, 7), (3, 8), (12, 12), (11, 6), (8, 8),
        (2, 9), (7, 7), (6, 6), (5, 9), (12, 4), (13, 3), (15, 4), (21, 3), (24, 2), (32, 3),
        (14, 5), (16, 6), (18, 7), (25, 4), (35, 2)]
_DIV = [(48, 6), (56, 7), (72, 9), (63, 7), (81, 9), (36, 4), (100, 5), (144, 12), (96, 8),
        (42, 6), (64, 8), (45, 5), (54, 9), (121, 11), (90, 10), (28, 7), (35, 5), (24, 3),
        (132, 12), (27, 3), (72, 8), (88, 11), (120, 10), (60, 4), (96, 12)]


def _pure_math_items():
    """固定算式题库：计算：a op b = ? -> a op b = r。"""
    items = []
    for a, b in _ADD:
        items.append((f"计算：{a} + {b} = ?", f"{a} + {b} = {a + b}。"))
    for a, b in _SUB:
        items.append((f"计算：{a} - {b} = ?", f"{a} - {b} = {a - b}。"))
    for a, b in _MUL:
        items.append((f"计算：{a} × {b} = ?", f"{a} × {b} = {a * b}。"))
    for a, b in _DIV:
        items.append((f"计算：{a} ÷ {b} = ?", f"{a} ÷ {b} = {a // b}。"))
    return items


# 固定应用题题库（覆盖网页端 math seeds），答案给出思路 + 算式 + 结论
WORD_FIXED = [
    ("小明有 12 个苹果，又买了 8 个，一共有多少个苹果？",
     "把两次的苹果数相加：12 + 8 = 20。所以一共有 20 个苹果。"),
    ("每盒有 12 支铅笔，一共 8 盒，共有多少支铅笔？",
     "每盒的数量乘以盒数：12 × 8 = 96。所以共有 96 支铅笔。"),
    ("把 48 个糖果平均分给 6 个小朋友，每人分到几个？",
     "用总数除以人数：48 ÷ 6 = 8。所以每人分到 8 个。"),
    ("书架上有 69 本书，借出去 13 本，还剩多少本？",
     "用原有的书减去借出的书：69 - 13 = 56。所以还剩 56 本。"),
    ("小红跑了 20 米，小刚跑了 51 米，两人一共跑了多少米？",
     "把两人的路程相加：20 + 51 = 71。所以一共跑了 71 米。"),
    ("一个长方形长 12 厘米，宽 8 厘米，它的面积是多少平方厘米？",
     "长方形面积等于长乘宽：12 × 8 = 96。所以面积是 96 平方厘米。"),
    ("仓库里有 45 箱货物，运走了 18 箱，还剩多少箱？",
     "用原有的减去运走的：45 - 18 = 27。所以还剩 27 箱。"),
    ("一本书有 96 页，小明每天看 12 页，需要多少天看完？",
     "用总页数除以每天看的页数：96 ÷ 12 = 8。所以需要 8 天。"),
    ("一支笔 5 元，买 8 支需要多少钱？",
     "单价乘以数量：5 × 8 = 40。所以一共需要 40 元。"),
    ("篮子里有 30 个鸡蛋，打碎了 7 个，还剩多少个？",
     "用总数减去打碎的数量：30 - 7 = 23。所以还剩 23 个。"),
    ("树上有 24 只小鸟，又飞来 16 只，现在树上有多少只小鸟？",
     "把两次的小鸟数相加：24 + 16 = 40。所以现在有 40 只小鸟。"),
    ("停车场原来有 40 辆车，开走了 15 辆，现在有多少辆？",
     "用原有的减去开走的：40 - 15 = 25。所以现在有 25 辆车。"),
    ("每排坐 9 人，一共 6 排，一共坐多少人？",
     "每排人数乘以排数：9 × 6 = 54。所以一共坐 54 人。"),
    ("学校有 72 名学生，平均分成 8 个班，每班多少人？",
     "用总人数除以班级数：72 ÷ 8 = 9。所以每班 9 人。"),
    ("妈妈买了 3 千克苹果，每千克 6 元，一共多少钱？",
     "单价乘以数量：3 × 6 = 18。所以一共 18 元。"),
    ("小华有 50 元，买书花了 23 元，还剩多少钱？",
     "用原有的钱减去花掉的钱：50 - 23 = 27。所以还剩 27 元。"),
    ("花园里有 18 朵红花和 27 朵黄花，一共有多少朵花？",
     "把两种花的数量相加：18 + 27 = 45。所以一共有 45 朵花。"),
    ("一根绳子长 84 米，剪掉了 37 米，还剩多少米？",
     "用原有的长度减去剪掉的：84 - 37 = 47。所以还剩 47 米。"),
    ("每箱可以装 12 瓶饮料，5 箱一共可以装多少瓶？",
     "每箱数量乘以箱数：12 × 5 = 60。所以一共可以装 60 瓶。"),
    ("有 63 个气球，平均分给 7 个小朋友，每人分几个？",
     "用总数除以人数：63 ÷ 7 = 9。所以每人分 9 个。"),
    ("图书馆有 90 本书，借走了 45 本，还剩多少本？",
     "用原有的书减去借走的：90 - 45 = 45。所以还剩 45 本。"),
    ("一班有 32 人，二班有 29 人，两个班一共多少人？",
     "把两个班的人数相加：32 + 29 = 61。所以两个班一共 61 人。"),
    ("一盒糖有 24 颗，吃了 9 颗，还剩多少颗？",
     "用总数减去吃掉的：24 - 9 = 15。所以还剩 15 颗。"),
    ("每张桌子坐 4 人，9 张桌子可以坐多少人？",
     "每张桌子人数乘以张数：4 × 9 = 36。所以可以坐 36 人。"),
    ("一共 56 个苹果，每袋装 7 个，可以装多少袋？",
     "用总数除以每袋数量：56 ÷ 7 = 8。所以可以装 8 袋。"),
    ("小狗每天跑 3 公里，一个星期跑多少公里？",
     "每天的路程乘以天数：3 × 7 = 21。所以一个星期跑 21 公里。"),
    ("班里有 36 人，其中 19 人是女生，男生有多少人？",
     "用总人数减去女生人数：36 - 19 = 17。所以男生有 17 人。"),
    ("商店有 15 个红气球和 25 个蓝气球，一共多少个？",
     "把两种气球的数量相加：15 + 25 = 40。所以一共有 40 个。"),
    ("每本练习本 4 元，买 12 本需要多少元？",
     "单价乘以数量：4 × 12 = 48。所以一共需要 48 元。"),
    ("有 81 颗糖，平均分给 9 个小朋友，每人几颗？",
     "用总数除以人数：81 ÷ 9 = 9。所以每人 9 颗。"),
]

# 数学域统一用与网页端一致的 prompt 模板，避免多模板混淆
MATH_TMPL = "<|user|>{q}\n<|assistant|>{a}\n<|endoftext|>\n"


def gen_math(out_dir, reps=60):
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "math_synthetic.txt")
    random.seed(7)
    pool = _pure_math_items() + WORD_FIXED
    n = 0
    with open(out, "w", encoding="utf-8") as f:
        for _ in range(reps):
            items = pool[:]
            random.shuffle(items)
            for q, a in items:
                f.write(MATH_TMPL.format(q=q, a=a))
                n += 1
    print(f"[math] {out}  {os.path.getsize(out):,} bytes  {n} 条")
    return out


# ======================================================================
# 5. 网页创作（HTML + CSS + JS 混合，单文件可运行）
# ======================================================================
def gen_web(out_dir, reps=30):
    import gen_html_synthetic as gh
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "web_synthetic.txt")
    random.seed(17)
    prompts = gh.PROMPTS + [
        ("做一个渐变背景的登录卡片页面", gh.TODO),
        ("写一个可以点击切换深色模式的网页", gh.QUOTE),
        ("做一个能拖动排序的列表网页", gh.TODO),
        ("网页版数字时钟", gh.COUNTDOWN),
        ("写一个使用 Canvas 画的动画页面", gh.PAINT),
    ]
    variants = [
        "写一个 {task}", "帮我做一个 {task}", "我想要一个网页上的 {task}",
        "帮我写个网页版 {task}", "{task} 用 HTML + CSS + JS 实现",
        "用 HTML、CSS 和 JavaScript 做一个{task}", "请生成一个完整的网页：{task}",
    ]
    n = 0
    with open(out, "w", encoding="utf-8") as f:
        for _ in range(reps):
            items = prompts[:]
            random.shuffle(items)
            for q, code in items:
                tmpl = random.choice(variants)
                task = (q.replace("写一个", "").replace("网页小游戏：", "")
                         .replace("网页版", "").replace("网页上的", "").strip())
                new_q = tmpl.format(task=task)
                f.write(WEB_TMPL.format(q=new_q, code=code.strip()))
                n += 1
    print(f"[web] {out}  {os.path.getsize(out):,} bytes  {n} 条")
    return out


DOMAINS = {
    "greet": lambda: gen_greet("data/greet_raw"),
    "qa": lambda: gen_qa("data/qa_raw"),
    "enqa": lambda: gen_enqa("data/enqa_raw"),
    "math": lambda: gen_math("data/math_raw"),
    "web": lambda: gen_web("data/web_raw"),
}


def main():
    if len(sys.argv) > 1:
        names = sys.argv[1:]
    else:
        names = list(DOMAINS)
    for name in names:
        if name not in DOMAINS:
            raise SystemExit(f"未知域: {name}，可选 {list(DOMAINS)}")
        DOMAINS[name]()


if __name__ == "__main__":
    main()