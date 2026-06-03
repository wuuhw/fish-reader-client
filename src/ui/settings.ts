import { AppConfig } from '../config';
import { el } from './dom';
import { listProfessions, parseProfession, buildGeneratorPrompt } from '../disguise/professions';
import { buildAboutBlock } from './about';

export type ApplyFn = (next: AppConfig) => void;

/** In-app settings modal: avatar, display name, and functional toggles. */
export class SettingsPanel {
  private overlay?: HTMLElement;
  private tempAvatar?: string; // pending avatar data URL (undefined = default)

  constructor(
    private cfg: AppConfig,
    private onApply: ApplyFn
  ) {}

  open() {
    this.tempAvatar = this.cfg.avatarDataUrl;
    this.build();
    document.body.appendChild(this.overlay!);
  }

  private close() {
    this.overlay?.remove();
    this.overlay = undefined;
  }

  private setPreview(preview: HTMLElement) {
    if (this.tempAvatar) {
      preview.style.backgroundImage = `url(${this.tempAvatar})`;
      preview.classList.add('has-img');
    } else {
      preview.style.backgroundImage = '';
      preview.classList.remove('has-img');
    }
  }

  private build() {
    const overlay = el('div', 'settings-overlay');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    const modal = el('div', 'settings-modal');
    const head = el('div', 'settings-head');
    head.appendChild(el('span', 'settings-title', '设置'));
    const closeBtn = el('button', 'icon-btn', '✕');
    closeBtn.addEventListener('click', () => this.close());
    head.appendChild(closeBtn);
    modal.appendChild(head);

    const bodyEl = el('div', 'settings-body');

    // ---- avatar + name ----
    const idRow = el('div', 'set-id-row');
    const preview = el('div', 'avatar set-avatar-preview');
    this.setPreview(preview);
    const idCol = el('div', 'set-id-col');

    const fileInput = el('input') as HTMLInputElement;
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        this.tempAvatar = String(reader.result);
        this.setPreview(preview);
      };
      reader.readAsDataURL(f);
    });

    const changeBtn = el('button', 'set-btn-ghost', '更换头像');
    changeBtn.addEventListener('click', () => fileInput.click());
    const resetBtn = el('button', 'set-btn-ghost', '恢复默认');
    resetBtn.addEventListener('click', () => {
      this.tempAvatar = undefined;
      this.setPreview(preview);
    });
    const avatarBtns = el('div', 'set-avatar-btns');
    avatarBtns.appendChild(changeBtn);
    avatarBtns.appendChild(resetBtn);
    idCol.appendChild(avatarBtns);
    idCol.appendChild(fileInput);

    idRow.appendChild(preview);
    idRow.appendChild(idCol);
    bodyEl.appendChild(this.field('头像', idRow));

    const nameInput = el('input', 'set-input') as HTMLInputElement;
    nameInput.type = 'text';
    nameInput.value = this.cfg.avatarName;
    nameInput.placeholder = '助手名称';
    bodyEl.appendChild(this.field('名称', nameInput));

    bodyEl.appendChild(el('div', 'set-divider'));

    // ---- profession (drives all fake "work" content) ----
    const profSelect = el('select', 'set-select') as HTMLSelectElement;
    const rebuildProfOptions = () => {
      profSelect.textContent = '';
      const customIds = new Set(this.cfg.customProfessions.map((c) => c.id));
      for (const p of listProfessions(this.cfg)) {
        const opt = el('option') as HTMLOptionElement;
        opt.value = p.id;
        opt.textContent = p.name + (customIds.has(p.id) ? ' · 自定义' : '');
        if (p.id === this.cfg.professionId) opt.selected = true;
        profSelect.appendChild(opt);
      }
    };
    rebuildProfOptions();
    const profWrap = el('div', 'set-select-wrap');
    profWrap.appendChild(profSelect);
    bodyEl.appendChild(this.field('伪装职业', profWrap));

    // custom professions: copy a prompt → generate JSON elsewhere → import here
    const custom = el('div', 'set-custom');
    custom.appendChild(
      el('div', 'set-custom-hint', '不是这些职业?填入你的职业名称,复制 Prompt 发给任意 AI,把它返回的 JSON 粘回来导入。')
    );

    const profNameInput = el('input', 'set-input') as HTMLInputElement;
    profNameInput.type = 'text';
    profNameInput.placeholder = '职业名称,如:律师 / 医生 / 同声传译';
    const nameRow = el('div', 'set-custom-name');
    nameRow.appendChild(profNameInput);
    custom.appendChild(nameRow);

    const copyBtn = el('button', 'set-btn-ghost', '复制生成 Prompt');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(buildGeneratorPrompt(profNameInput.value));
        copyBtn.textContent = '已复制 ✓';
        setTimeout(() => (copyBtn.textContent = '复制生成 Prompt'), 1500);
      } catch {
        copyBtn.textContent = '复制失败';
      }
    });
    custom.appendChild(copyBtn);

    const ta = el('textarea', 'set-json') as HTMLTextAreaElement;
    ta.placeholder = '把其它 AI 生成的职业 JSON 粘贴到这里…';
    custom.appendChild(ta);

    const importMsg = el('span', 'set-import-msg');
    const importBtn = el('button', 'set-btn-primary', '导入 JSON');
    const customList = el('div', 'set-custom-list');
    const renderCustomList = () => {
      customList.textContent = '';
      for (const p of this.cfg.customProfessions) {
        const row = el('div', 'set-custom-item');
        row.appendChild(el('span', undefined, `${p.name}(${p.bossTurns.length} 问答 · ${p.readingInserts.length} 穿插)`));
        const del = el('button', 'set-btn-ghost', '删除');
        del.addEventListener('click', () => {
          this.cfg.customProfessions = this.cfg.customProfessions.filter((x) => x.id !== p.id);
          if (this.cfg.professionId === p.id) this.cfg.professionId = 'programmer';
          this.onApply({ ...this.cfg });
          rebuildProfOptions();
          renderCustomList();
        });
        row.appendChild(del);
        customList.appendChild(row);
      }
    };
    importBtn.addEventListener('click', () => {
      const prof = parseProfession(ta.value);
      if (!prof) {
        importMsg.textContent = 'JSON 格式不对,检查后重试';
        importMsg.className = 'set-import-msg err';
        return;
      }
      const i = this.cfg.customProfessions.findIndex((x) => x.id === prof.id);
      if (i >= 0) this.cfg.customProfessions[i] = prof;
      else this.cfg.customProfessions.push(prof);
      this.cfg.professionId = prof.id;
      this.onApply({ ...this.cfg });
      rebuildProfOptions();
      profSelect.value = prof.id;
      renderCustomList();
      ta.value = '';
      importMsg.textContent = `已导入「${prof.name}」`;
      importMsg.className = 'set-import-msg ok';
    });
    const importRow = el('div', 'set-import-row');
    importRow.appendChild(importBtn);
    importRow.appendChild(importMsg);
    custom.appendChild(importRow);
    renderCustomList();
    custom.appendChild(customList);
    bodyEl.appendChild(this.section('自定义职业', custom));

    bodyEl.appendChild(el('div', 'set-divider'));

    // ---- functional settings ----
    const speedSel = this.select(['slow', 'normal', 'fast', 'off'], this.cfg.fakeThinkingSpeed, {
      slow: '慢',
      normal: '正常',
      fast: '快',
      off: '关闭(整段直出)',
    });
    bodyEl.appendChild(this.field('流式速度', speedSel));

    const diffChk = this.checkbox(this.cfg.fakeDiffEnabled);
    bodyEl.appendChild(this.field('假 diff', diffChk));

    const freqInput = el('input', 'set-input set-range') as HTMLInputElement;
    freqInput.type = 'range';
    freqInput.min = '0';
    freqInput.max = '1';
    freqInput.step = '0.05';
    freqInput.value = String(this.cfg.fakeDiffFrequency);
    const freqVal = el('span', 'set-range-val', String(this.cfg.fakeDiffFrequency));
    freqInput.addEventListener('input', () => (freqVal.textContent = freqInput.value));
    const freqWrap = el('div', 'set-range-wrap');
    freqWrap.appendChild(freqInput);
    freqWrap.appendChild(freqVal);
    bodyEl.appendChild(this.field('假 diff 概率', freqWrap));

    bodyEl.appendChild(el('div', 'set-divider'));

    const actionSel = this.select(['disguise', 'minimize', 'hide'], this.cfg.bossAction, {
      disguise: '伪装工作对话',
      minimize: '最小化窗口',
      hide: '隐藏窗口',
    });
    bodyEl.appendChild(this.field('老板键动作', actionSel));

    const blurChk = this.checkbox(this.cfg.bossTriggers.includes('blur'));
    bodyEl.appendChild(this.field('失焦自动触发', blurChk));
    const leaveChk = this.checkbox(this.cfg.bossTriggers.includes('mouseLeave'));
    bodyEl.appendChild(this.field('鼠标离开触发', leaveChk));

    const blurDelay = this.numberInput(this.cfg.bossBlurDelay);
    bodyEl.appendChild(this.field('失焦延迟 (ms)', blurDelay));
    const leaveDelay = this.numberInput(this.cfg.bossMouseLeaveDelay);
    bodyEl.appendChild(this.field('离开延迟 (ms)', leaveDelay));

    const autoExitChk = this.checkbox(this.cfg.bossAutoExit);
    bodyEl.appendChild(this.field('被动方式自动退出', autoExitChk));

    bodyEl.appendChild(el('div', 'set-divider'));

    const charsInput = this.numberInput(this.cfg.charsPerPage);
    bodyEl.appendChild(this.field('每页字数', charsInput));

    const encSel = this.select(['auto', 'utf-8', 'gbk', 'gb18030'], this.cfg.encoding, {
      auto: '自动',
      'utf-8': 'UTF-8',
      gbk: 'GBK',
      gb18030: 'GB18030',
    });
    bodyEl.appendChild(this.field('编码', encSel));

    bodyEl.appendChild(el('div', 'set-divider'));

    // ---- 关于(版本 + 官网/GitHub/抖音) ----
    bodyEl.appendChild(this.section('关于', buildAboutBlock()));

    modal.appendChild(bodyEl);

    // ---- footer ----
    const foot = el('div', 'settings-foot');
    const cancel = el('button', 'set-btn-ghost', '取消');
    cancel.addEventListener('click', () => this.close());
    const save = el('button', 'set-btn-primary', '保存');
    save.addEventListener('click', () => {
      const triggers: Array<'blur' | 'mouseLeave'> = [];
      if ((blurChk.querySelector('input') as HTMLInputElement).checked) triggers.push('blur');
      if ((leaveChk.querySelector('input') as HTMLInputElement).checked) triggers.push('mouseLeave');

      const next: AppConfig = {
        ...this.cfg,
        avatarName: nameInput.value.trim() || '豆包',
        avatarDataUrl: this.tempAvatar,
        professionId: profSelect.value,
        fakeThinkingSpeed: (speedSel.querySelector('select') as HTMLSelectElement).value as any,
        fakeDiffEnabled: (diffChk.querySelector('input') as HTMLInputElement).checked,
        fakeDiffFrequency: parseFloat(freqInput.value),
        bossAction: (actionSel.querySelector('select') as HTMLSelectElement).value as any,
        bossTriggers: triggers,
        bossBlurDelay: parseInt((blurDelay.querySelector('input') as HTMLInputElement).value, 10) || 0,
        bossMouseLeaveDelay:
          parseInt((leaveDelay.querySelector('input') as HTMLInputElement).value, 10) || 0,
        bossAutoExit: (autoExitChk.querySelector('input') as HTMLInputElement).checked,
        charsPerPage: parseInt((charsInput.querySelector('input') as HTMLInputElement).value, 10) || 300,
        encoding: (encSel.querySelector('select') as HTMLSelectElement).value as any,
      };
      this.onApply(next);
      this.close();
    });
    foot.appendChild(cancel);
    foot.appendChild(save);
    modal.appendChild(foot);

    overlay.appendChild(modal);
    this.overlay = overlay;
  }

  // ---- small builders ----
  private field(label: string, control: HTMLElement): HTMLElement {
    const row = el('div', 'set-field');
    row.appendChild(el('div', 'set-label', label));
    const ctrl = el('div', 'set-control');
    ctrl.appendChild(control);
    row.appendChild(ctrl);
    return row;
  }

  /** A full-width, vertically-stacked section (label on top, control below). */
  private section(label: string, control: HTMLElement): HTMLElement {
    const row = el('div', 'set-section');
    row.appendChild(el('div', 'set-label', label));
    row.appendChild(control);
    return row;
  }

  private select(values: string[], current: string, labels: Record<string, string>): HTMLElement {
    const wrap = el('div', 'set-select-wrap');
    const sel = el('select', 'set-select') as HTMLSelectElement;
    for (const v of values) {
      const opt = el('option') as HTMLOptionElement;
      opt.value = v;
      opt.textContent = labels[v] ?? v;
      if (v === current) opt.selected = true;
      sel.appendChild(opt);
    }
    wrap.appendChild(sel);
    return wrap;
  }

  private checkbox(checked: boolean): HTMLElement {
    const wrap = el('label', 'set-switch');
    const input = el('input') as HTMLInputElement;
    input.type = 'checkbox';
    input.checked = checked;
    const slider = el('span', 'set-switch-slider');
    wrap.appendChild(input);
    wrap.appendChild(slider);
    return wrap;
  }

  private numberInput(value: number): HTMLElement {
    const wrap = el('div', 'set-num-wrap');
    const input = el('input', 'set-input') as HTMLInputElement;
    input.type = 'number';
    input.value = String(value);
    wrap.appendChild(input);
    return wrap;
  }
}
