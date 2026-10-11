# -*- coding: utf-8 -*-
"""将三份劳动实践报告截图还原为可编辑的 文字+图片 表格 docx"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.oxml.ns import qn

OUT = r'd:\yjs\docx_extract\输出'
os.makedirs(OUT, exist_ok=True)
IMG = r'd:\yjs\docx_extract'

FONT = '宋体'

def set_font(run, size=10.5, bold=False):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.name = 'Times New Roman'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), FONT)

def cell_text(cell, text, size=10.5, bold=False, align='left', valign='center'):
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER if valign == 'center' else WD_ALIGN_VERTICAL.TOP
    lines = text.split('\n')
    first = True
    for line in lines:
        p = cell.paragraphs[0] if first else cell.add_paragraph()
        first = False
        p.alignment = {'left': WD_ALIGN_PARAGRAPH.LEFT,
                       'center': WD_ALIGN_PARAGRAPH.CENTER}[align]
        p.paragraph_format.line_spacing = 1.25
        r = p.add_run(line)
        set_font(r, size, bold)

def add_label(cell, text):
    """竖排标签格"""
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    p = cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for i, ch in enumerate(text):
        if i:
            p.add_run().add_break()
        r = p.add_run(ch)
        set_font(r, 14, bold=True)

def set_borders(table):
    tbl = table._tbl
    tblPr = tbl.tblPr
    borders = tblPr.makeelement(qn('w:tblBorders'), {})
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = borders.makeelement(qn('w:' + edge), {
            qn('w:val'): 'single', qn('w:sz'): '6',
            qn('w:space'): '0', qn('w:color'): '000000'})
        borders.append(e)
    tblPr.append(borders)

def title(doc):
    # 附件1 + 标题 同一行
    t = doc.add_table(rows=1, cols=2)
    t.autofit = False
    t.columns[0].width = Cm(4)
    t.columns[1].width = Cm(13)
    cell_text(t.rows[0].cells[0], '附件1', 14, align='left')
    cell_text(t.rows[0].cells[1], '劳动实践报告', 18, bold=True, align='center')
    doc.add_paragraph()

def info_table(doc, cls, name, content, time, teacher):
    t = doc.add_table(rows=2, cols=6)
    t.autofit = False
    widths = [2.0, 3.2, 2.0, 3.2, 2.6, 4.0]
    for i, w in enumerate(widths):
        t.columns[i].width = Cm(w)
    r = t.rows[0].cells
    cell_text(r[0], '班级', 11, True, 'center')
    cell_text(r[1], cls, 11, False, 'center')
    cell_text(r[2], '姓名', 11, True, 'center')
    cell_text(r[3], name, 11, False, 'center')
    cell_text(r[4], '劳动\n内容', 11, True, 'center')
    cell_text(r[5], content, 11, False, 'center')
    r = t.rows[1].cells
    cell_text(r[0], '劳动\n时间', 11, True, 'center')
    cell_text(r[1], time, 11, False, 'center')
    cell_text(r[2], '评价\n等级', 11, True, 'center')
    cell_text(r[3], '', 11, False, 'center')
    cell_text(r[4], '班主任', 11, True, 'center')
    cell_text(r[5], teacher, 11, False, 'center')
    return t

def body_table(doc, label, report_paras, img_path, img_cm=8.5, img_first=True):
    """劳动报告：左侧竖标签，右侧文字+图片"""
    t = doc.add_table(rows=1, cols=2)
    t.autofit = False
    t.columns[0].width = Cm(1.8)
    t.columns[1].width = Cm(15.2)
    add_label(t.rows[0].cells[0], label)
    c = t.rows[0].cells[1]
    c.vertical_alignment = WD_ALIGN_VERTICAL.TOP
    first = True
    if img_first:
        p = c.paragraphs[0] if first else c.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(img_path, width=Cm(img_cm))
        first = False
    for para in report_paras:
        p = c.paragraphs[0] if first else c.add_paragraph()
        first = False
        p.paragraph_format.first_line_indent = Pt(21)
        p.paragraph_format.line_spacing = 1.3
        run = p.add_run(para)
        set_font(run, 10.5)
    if not img_first:
        p = c.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(img_path, width=Cm(img_cm))
    return t

def base_doc():
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(2)
    sec.top_margin = sec.bottom_margin = Cm(2)
    style = doc.styles['Normal']
    style.font.name = 'Times New Roman'
    style.font.size = Pt(10.5)
    style._element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    return doc

# ============ 1. 付志成 ============
doc = base_doc()
title(doc)
info_table(doc, '高一.15班', '付志成', '日常农务', '2026.10.1', '陈利')
body_table(doc, '劳动报告', [
    '假期中，我回到农村老家，参与农村晒稻谷这一农民日常农事活动。晒稻谷看似简单，却是稻谷从田间走向餐桌的关键一步。通过参与摊晒、翻谷、去杂、收谷等劳动，我通过稻谷晾晒的具体流程，体会农民的真实劳动状态，并记录传统农业劳动中的经验与智慧，了解粮食的来之不易。'
], os.path.join(IMG, '付志成劳动实践报告', 'image1.jpeg'), img_cm=8.0, img_first=True)
body_table(doc, '劳动感悟', [
    '这次晒稻谷劳动，让我对"粒粒皆辛苦"有了更真切的理解。以前在课本上读到这句话，只觉得是一句古诗；当我真正站在晒场上，顶着太阳翻谷、收谷，才明白每一粒米都来之不易，凝聚着农民长期的汗水。',
    '晒谷也让我看到劳动中的智慧。农民没有复杂的仪器，却能通过云层、风向、湿度和手感判断天气与稻谷干湿。他们知道什么时候摊晒，什么时候翻谷，什么时候收堆。这些经验不是书本上直接能学到的，而是在长期劳动中积累下来的。它让我明白，实践本身就是一所大学。',
    '同时，我也体会到农民的不易。晒谷最怕天气突变，一阵雨就可能让辛苦劳作的成果受损。很多时候，全家老小一起上阵，邻里之间也会互相帮忙。这种协作与互助，让我感受到农村朴素而温暖的人情。',
    '作为学生，我平时很少有机会接触这样的农活。这次实践让我走出了书本，走进了真实的劳动现场。我不仅学会了使用谷耙、木锨等农具，也学会了耐心、细心和坚持。更重要的是，我开始真正尊重劳动、尊重农民、珍惜粮食。以后在食堂吃饭，我会提醒自己按需取餐，不随意浪费，因为每一碗米饭背后，都有无数这样的劳动过程。'
], '', img_first=True) if False else None
# 感悟单独一表（无图）
t = doc.add_table(rows=1, cols=2)
t.autofit = False
t.columns[0].width = Cm(1.8); t.columns[1].width = Cm(15.2)
add_label(t.rows[0].cells[0], '劳动感悟')
c = t.rows[0].cells[1]; c.vertical_alignment = WD_ALIGN_VERTICAL.TOP
for i, para in enumerate([
    '这次晒稻谷劳动，让我对"粒粒皆辛苦"有了更真切的理解。以前在课本上读到这句话，只觉得是一句古诗；当我真正站在晒场上，顶着太阳翻谷、收谷，才明白每一粒米都来之不易，凝聚着农民长期的汗水。',
    '晒谷也让我看到劳动中的智慧。农民没有复杂的仪器，却能通过云层、风向、湿度和手感判断天气与稻谷干湿。他们知道什么时候摊晒，什么时候翻谷，什么时候收堆。这些经验不是书本上直接能学到的，而是在长期劳动中积累下来的。它让我明白，实践本身就是一所大学。',
    '同时，我也体会到农民的不易。晒谷最怕天气突变，一阵雨就可能让辛苦劳作的成果受损。很多时候，全家老小一起上阵，邻里之间也会互相帮忙。这种协作与互助，让我感受到农村朴素而温暖的人情。',
    '作为学生，我平时很少有机会接触这样的农活。这次实践让我走出了书本，走进了真实的劳动现场。我不仅学会了使用谷耙、木锨等农具，也学会了耐心、细心和坚持。更重要的是，我开始真正尊重劳动、尊重农民、珍惜粮食。以后在食堂吃饭，我会提醒自己按需取餐，不随意浪费，因为每一碗米饭背后，都有无数这样的劳动过程。']):
    p = c.paragraphs[0] if i == 0 else c.add_paragraph()
    p.paragraph_format.first_line_indent = Pt(21); p.paragraph_format.line_spacing = 1.3
    set_font(p.add_run(para), 10.5)
for tb in doc.tables: set_borders(tb)
doc.save(os.path.join(OUT, '付志成劳动实践报告.docx'))

# ============ 2. 何瑞淇 ============
doc = base_doc()
title(doc)
info_table(doc, '高一15班', '何瑞淇', '晒谷子、育苗', '2026年9月28日、\n29日', '陈利')
body_table(doc, '劳动报告', [
    '来到劳动场地后，首先学习工具使用方法。晒谷耙看着简单，实际操作并不轻松，要控制好力度，推耙时保持平稳，把谷层摊开形成波浪状，增大受光面积。一开始我耙出来的谷层厚薄不均，反复练习之后，动作慢慢熟练，可以高效完成大片谷场的翻晒工作。',
    '晒谷间隙，我转移到地块开展育苗劳动，蹲在地上整理育苗基质，小心排布秧盘。长时间弯腰、蹲姿很快就让腰背发酸，汗水顺着脸颊流下，才体会到农活持续劳作的辛苦。整个过程循环往复，既要顾着翻晒粮食，也要细心打理秧盘，感受农事一环扣一环，容不得马虎。'
], os.path.join(IMG, '何瑞淇劳动实践报告', 'image1.jpeg'), img_cm=8.5, img_first=False)
t = doc.add_table(rows=1, cols=2)
t.autofit = False
t.columns[0].width = Cm(1.8); t.columns[1].width = Cm(15.2)
add_label(t.rows[0].cells[0], '劳动感悟')
c = t.rows[0].cells[1]; c.vertical_alignment = WD_ALIGN_VERTICAL.TOP
for i, para in enumerate([
    '亲手参与晒谷、育苗这些农活之后，我才真正读懂"谁知盘中餐，粒粒皆辛苦"的重量。从前只在课本里读到粮食来之不易，站在晒满稻谷的院坝里，握着沉甸甸的耙子，弯腰整理秧盘，腰背酸痛、满身汗水的时候，才真切体会到农民日复一日耕耘的辛劳。',
    '粮食从播种育苗，到田间管护，再到收割晾晒，要经历许许多多工序，每一步都要付出大量时间与体力，任何环节松懈都可能影响收成。晒谷要看天气，育苗要讲细心，农事依靠耐心和经验，大自然的馈赠背后，是劳动者常年的坚守。',
    '这次劳动也让我明白劳动本身的意义。劳动不是口头的口号，而是实实在在动手去做。我们享用每一碗米饭，都凝聚着无数人的汗水。今后我会更加珍惜粮食，自觉杜绝浪费，尊重每一位劳动者。同时在生活中主动承担劳动任务，不怕苦不怕累，在劳动当中磨炼意志，学会脚踏实地，用双手创造价值。']):
    p = c.paragraphs[0] if i == 0 else c.add_paragraph()
    p.paragraph_format.first_line_indent = Pt(21); p.paragraph_format.line_spacing = 1.3
    set_font(p.add_run(para), 10.5)
for tb in doc.tables: set_borders(tb)
doc.save(os.path.join(OUT, '何瑞淇劳动实践报告.docx'))

# ============ 3. 王若涵 ============
doc = base_doc()
title(doc)
info_table(doc, '高一15', '王若涵', '采柠檬、做饭、采竹笋', '9.31', '陈利')
body_table(doc, '劳动报告', [
    '三、劳动过程',
    '到达果园后，我们先观察果实成熟状态，学习正确采摘方式，避免损伤树枝。果树有一定高度，抬手采摘久了手臂发酸，小伙伴之间互相帮忙传递果实、分装收纳，合力完成采收任务。',
    '回到农家厨房，我们分工合作处理食材：清洗鲜笋、调配酥肉面糊、切配配菜。掌勺时炉火滚烫，颠勺翻炒需要力气，油烟扑面而来。一开始翻炒节奏生疏，慢慢调整火候，把控咸淡。一道道菜肴陆续出锅，摆满餐桌，所有人一起品尝劳动成果。'
], os.path.join(IMG, '王若涵', 'image1.png'), img_cm=7.5, img_first=True)
t = doc.add_table(rows=1, cols=2)
t.autofit = False
t.columns[0].width = Cm(1.8); t.columns[1].width = Cm(15.2)
add_label(t.rows[0].cells[0], '劳动感悟')
c = t.rows[0].cells[1]; c.vertical_alignment = WD_ALIGN_VERTICAL.TOP
p0 = c.paragraphs[0]; set_font(p0.add_run('劳动感悟'), 10.5, bold=True)
for para in [
    '这次田园劳动，让我体会到从枝头到餐桌完整劳动链条的乐趣。以前总觉得采摘、做饭是很简单的事，真正上手才知道并不轻松：抬手摘果手臂酸痛，灶台前高温烟熏，每一道菜都要耐心把控火候与调味。',
    '劳动不是单一的付出，更充满协作的温暖。大家分工配合，有人采摘、有人备菜、有人掌勺，齐心协力才完成全部任务。当品尝自己亲手采摘食材、亲手烹制的饭菜时，滋味格外香甜，这就是劳动带来的成就感。',
    '我懂得了每一份美食背后，都包含采收、加工无数劳动者的付出。今后我会更加珍惜食物，热爱劳动，主动尝试动手实践，在劳动中锻炼动手能力，感受耕耘与收获的快乐，学会和同伴协作，用双手创造美好。']:
    p = c.add_paragraph(); p.paragraph_format.first_line_indent = Pt(21); p.paragraph_format.line_spacing = 1.3
    set_font(p.add_run(para), 10.5)
for tb in doc.tables: set_borders(tb)
doc.save(os.path.join(OUT, '王若涵.docx'))

print('done ->', OUT)
for fn in os.listdir(OUT):
    print(' ', fn, os.path.getsize(os.path.join(OUT, fn)))
