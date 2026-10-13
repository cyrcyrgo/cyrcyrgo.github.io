# -*- coding: utf-8 -*-
"""生成最终版：可编辑文字 + 9张实拍照片（3x3），优化排版"""
import os
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.oxml.ns import qn

OUT = r'd:\lumina\docx_extract\输出'
IMG = r'd:\lumina\docx_extract'
os.makedirs(OUT, exist_ok=True)
FONT = '宋体'

def set_font(run, size=10.5, bold=False):
    run.font.size = Pt(size); run.font.bold = bold
    run.font.name = 'Times New Roman'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), FONT)

def cell_text(cell, text, size=11, bold=False, align='center'):
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    first = True
    for line in text.split('\n'):
        p = cell.paragraphs[0] if first else cell.add_paragraph()
        first = False
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER if align == 'center' else WD_ALIGN_PARAGRAPH.LEFT
        set_font(p.add_run(line), size, bold)

def add_label(cell, text):
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    p = cell.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for i, ch in enumerate(text):
        if i: p.add_run().add_break()
        set_font(p.add_run(ch), 14, True)

def set_borders(table, sz='6'):
    tblPr = table._tbl.tblPr
    old = tblPr.find(qn('w:tblBorders'))
    if old is not None: tblPr.remove(old)
    b = tblPr.makeelement(qn('w:tblBorders'), {})
    for edge in ('top','left','bottom','right','insideH','insideV'):
        e = b.makeelement(qn('w:'+edge), {qn('w:val'):'single', qn('w:sz'):sz,
            qn('w:space'):'0', qn('w:color'):'000000'})
        b.append(e)
    tblPr.append(b)

def no_borders(table):
    tblPr = table._tbl.tblPr
    b = tblPr.makeelement(qn('w:tblBorders'), {})
    for edge in ('top','left','bottom','right','insideH','insideV'):
        b.append(b.makeelement(qn('w:'+edge), {qn('w:val'):'none'}))
    tblPr.append(b)

def base_doc():
    doc = Document()
    s = doc.sections[0]
    s.page_width, s.page_height = Cm(21), Cm(29.7)
    s.left_margin = s.right_margin = Cm(2.2)
    s.top_margin = s.bottom_margin = Cm(2.2)
    st = doc.styles['Normal']; st.font.name = 'Times New Roman'; st.font.size = Pt(10.5)
    st._element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    return doc

def add_title(doc):
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_font(p.add_run('附件1'), 12)
    p2 = doc.add_paragraph(); p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p2.add_run('劳动实践报告'), 20, True)

def add_info(doc, cls, name, content, time):
    t = doc.add_table(rows=2, cols=6); t.autofit = False
    for i, w in enumerate([2.0,3.3,1.8,3.3,2.4,3.8]):
        t.columns[i].width = Cm(w)
    r = t.rows[0].cells
    cell_text(r[0],'班级'); cell_text(r[1],cls); cell_text(r[2],'姓名'); cell_text(r[3],name)
    cell_text(r[4],'劳动\n内容'); cell_text(r[5],content)
    r = t.rows[1].cells
    cell_text(r[0],'劳动\n时间'); cell_text(r[1],time); cell_text(r[2],'评价\n等级'); cell_text(r[3],'')
    cell_text(r[4],'班主任'); cell_text(r[5],'陈利')
    set_borders(t)
    return t

def add_photos(doc, photo_dir, n=9, cell_cm=5.0):
    """无边框 3x3 照片表"""
    t = doc.add_table(rows=3, cols=3); t.autofit = False
    for i in range(3): t.columns[i].width = Cm(cell_cm)
    for idx in range(n):
        c = t.cell(idx//3, idx%3)
        c.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        p = c.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(2); p.paragraph_format.space_after = Pt(2)
        run = p.add_run()
        run.add_picture(os.path.join(photo_dir, f'{idx+1}.jpg'), width=Cm(cell_cm-0.25))
    no_borders(t)
    return t

def add_section(doc, label, paras, photo_dir=None, photo_caption='劳动现场照片',
                photo_pos='after_title', cell_cm=5.0):
    t = doc.add_table(rows=1, cols=2); t.autofit = False
    t.columns[0].width = Cm(1.6); t.columns[1].width = Cm(15.0)
    add_label(t.rows[0].cells[0], label)
    c = t.rows[0].cells[1]; c.vertical_alignment = WD_ALIGN_VERTICAL.TOP
    first = True
    photo_inserted = False
    def new_para():
        nonlocal first
        p = c.paragraphs[0] if first else c.add_paragraph()
        first = False
        return p
    for i, para in enumerate(paras):
        p = new_para()
        if para.startswith('#'):  # 小标题
            set_font(p.add_run(para.lstrip('# ').strip()), 11, True)
            p.paragraph_format.space_before = Pt(2)
        else:
            p.paragraph_format.first_line_indent = Pt(21)
            p.paragraph_format.line_spacing = 1.35
            p.paragraph_format.space_after = Pt(4)
            set_font(p.add_run(para), 10.5)
        if photo_dir and not photo_inserted and photo_pos == 'after_title':
            add_photos_in_cell(c, photo_dir)
            photo_inserted = True
            first = False
    if photo_dir and photo_pos == 'end':
        cap = c.add_paragraph(); cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_font(cap.add_run(photo_caption), 9)
        add_photos_in_cell(c, photo_dir)
    set_borders(t)
    return t

def add_photos_in_cell(cell, photo_dir, first_paragraph=False):
    """在单元格内嵌套3x3照片表"""
    nt = cell.add_table(rows=3, cols=3)
    nt.autofit = False
    ccm = 4.7
    for i in range(3): nt.columns[i].width = Cm(ccm)
    for idx in range(9):
        cc = nt.cell(idx//3, idx%3)
        cc.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        p = cc.paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(1); p.paragraph_format.space_after = Pt(1)
        p.add_run().add_picture(os.path.join(photo_dir, f'{idx+1}.jpg'), width=Cm(ccm-0.2))
    no_borders(nt)

# ===== 付志成 =====
doc = base_doc(); add_title(doc)
add_info(doc, '高一.15班', '付志成', '日常农务', '2026.10.1')
add_section(doc, '劳动报告', [
    '假期中，我回到农村老家，参与农村晒稻谷这一农民日常农事活动。晒稻谷看似简单，却是稻谷从田间走向餐桌的关键一步。通过参与摊晒、翻谷、去杂、收谷等劳动，我通过稻谷晾晒的具体流程，体会农民的真实劳动状态，并记录传统农业劳动中的经验与智慧，了解粮食的来之不易。'
], photo_dir=os.path.join(IMG,'付志成_photos'))
add_section(doc, '劳动感悟', [
    '这次晒稻谷劳动，让我对“粒粒皆辛苦”有了更真切的理解。以前在课本上读到这句话，只觉得是一句古诗；当我真正站在晒场上，顶着太阳翻谷、收谷，才明白每一粒米都来之不易，凝聚着农民长期的汗水。',
    '晒谷也让我看到劳动中的智慧。农民没有复杂的仪器，却能通过云层、风向、湿度和手感判断天气与稻谷干湿。他们知道什么时候摊晒，什么时候翻谷，什么时候收堆。这些经验不是书本上直接能学到的，而是在长期劳动中积累下来的。它让我明白，实践本身就是一所大学。',
    '同时，我也体会到农民的不易。晒谷最怕天气突变，一阵雨就可能让辛苦劳作的成果受损。很多时候，全家老小一起上阵，邻里之间也会互相帮忙。这种协作与互助，让我感受到农村朴素而温暖的人情。',
    '作为学生，我平时很少有机会接触这样的农活。这次实践让我走出了书本，走进了真实的劳动现场。我不仅学会了使用谷耙、木锨等农具，也学会了耐心、细心和坚持。更重要的是，我开始真正尊重劳动、尊重农民、珍惜粮食。以后在食堂吃饭，我会提醒自己按需取餐，不随意浪费，因为每一碗米饭背后，都有无数这样的劳动过程。'])
doc.save(os.path.join(OUT,'付志成劳动实践报告.docx'))

# ===== 何瑞淇 =====
doc = base_doc(); add_title(doc)
add_info(doc, '高一15班', '何瑞淇', '晒谷子、育苗', '2026年9月28日、\n29日')
add_section(doc, '劳动报告', [
    '来到劳动场地后，首先学习工具使用方法。晒谷耙看着简单，实际操作并不轻松，要控制好力度，推耙时保持平稳，把谷层摊开形成波浪状，增大受光面积。一开始我耙出来的谷层厚薄不均，反复练习之后，动作慢慢熟练，可以高效完成大片谷场的翻晒工作。',
    '晒谷间隙，我转移到地块开展育苗劳动，蹲在地上整理育苗基质，小心排布秧盘。长时间弯腰、蹲姿很快就让腰背发酸，汗水顺着脸颊流下，才体会到农活持续劳作的辛苦。整个过程循环往复，既要顾着翻晒粮食，也要细心打理秧盘，感受农事一环扣一环，容不得马虎。'
], photo_dir=os.path.join(IMG,'何瑞淇_photos'))
add_section(doc, '劳动感悟', [
    '亲手参与晒谷、育苗这些农活之后，我才真正读懂“谁知盘中餐，粒粒皆辛苦”的重量。从前只在课本里读到粮食来之不易，站在晒满稻谷的院坝里，握着沉甸甸的耙子，弯腰整理秧盘，腰背酸痛、满身汗水的时候，才真切体会到农民日复一日耕耘的辛劳。',
    '粮食从播种育苗，到田间管护，再到收割晾晒，要经历许许多多工序，每一步都要付出大量时间与体力，任何环节松懈都可能影响收成。晒谷要看天气，育苗要讲细心，农事依靠耐心和经验，大自然的馈赠背后，是劳动者常年的坚守。',
    '这次劳动也让我明白劳动本身的意义。劳动不是口头的口号，而是实实在在动手去做。我们享用每一碗米饭，都凝聚着无数人的汗水。今后我会更加珍惜粮食，自觉杜绝浪费，尊重每一位劳动者。同时在生活中主动承担劳动任务，不怕苦不怕累，在劳动当中磨炼意志，学会脚踏实地，用双手创造价值。'])
doc.save(os.path.join(OUT,'何瑞淇劳动实践报告.docx'))

# ===== 王若涵 =====
doc = base_doc(); add_title(doc)
add_info(doc, '高一15', '王若涵', '采柠檬、做饭、采竹笋', '9.31')
add_section(doc, '劳动报告', [
    '# 三、劳动过程'
], photo_dir=os.path.join(IMG,'王若涵_photos'))
# 王若涵照片后需要另起文字——在同一劳动报告区补文字较复杂，改为照片单独成区
# 简化：重建王若涵劳动报告（文字+图+文）
doc = base_doc(); add_title(doc)
add_info(doc, '高一15', '王若涵', '采柠檬、做饭、采竹笋', '9.31')
t = doc.add_table(rows=1, cols=2); t.autofit=False
t.columns[0].width=Cm(1.6); t.columns[1].width=Cm(15.0)
add_label(t.rows[0].cells[0],'劳动报告')
c=t.rows[0].cells[1]; c.vertical_alignment=WD_ALIGN_VERTICAL.TOP
p=c.paragraphs[0]; set_font(p.add_run('三、劳动过程'),11,True)
add_photos_in_cell(c, os.path.join(IMG,'王若涵_photos'))
for para in [
    '到达果园后，我们先观察果实成熟状态，学习正确采摘方式，避免损伤树枝。果树有一定高度，抬手采摘久了手臂发酸，小伙伴之间互相帮忙传递果实、分装收纳，合力完成采收任务。',
    '回到农家厨房，我们分工合作处理食材：清洗鲜笋、调配酥肉面糊、切配配菜。掌勺时炉火滚烫，颠勺翻炒需要力气，油烟扑面而来。一开始翻炒节奏生疏，慢慢调整火候，把控咸淡。一道道菜肴陆续出锅，摆满餐桌，所有人一起品尝劳动成果。']:
    pp=c.add_paragraph(); pp.paragraph_format.first_line_indent=Pt(21); pp.paragraph_format.line_spacing=1.35
    pp.paragraph_format.space_after=Pt(4); set_font(pp.add_run(para),10.5)
set_borders(t)
add_section(doc,'劳动感悟',[
    '这次田园劳动，让我体会到从枝头到餐桌完整劳动链条的乐趣。以前总觉得采摘、做饭是很简单的事，真正上手才知道并不轻松：抬手摘果手臂酸痛，灶台前高温烟熏，每一道菜都要耐心把控火候与调味。',
    '劳动不是单一的付出，更充满协作的温暖。大家分工配合，有人采摘、有人备菜、有人掌勺，齐心协力才完成全部任务。当品尝自己亲手采摘食材、亲手烹制的饭菜时，滋味格外香甜，这就是劳动带来的成就感。',
    '我懂得了每一份美食背后，都包含采收、加工无数劳动者的付出。今后我会更加珍惜食物，热爱劳动，主动尝试动手实践，在劳动中锻炼动手能力，感受耕耘与收获的快乐，学会和同伴协作，用双手创造美好。'])
doc.save(os.path.join(OUT,'王若涵.docx'))

print('OK')
for fn in os.listdir(OUT):
    d=__import__('docx').Document(os.path.join(OUT,fn))
    print(fn,'表格',len(d.tables),'图片',len(d.inline_shapes))
