import { AppConfig } from '../config';
import { el } from './dom';
import { buildFollowLinks } from './about';
import { BRAND, FOLLOW_PITCH } from '../brand';

export type OnboardDoneFn = (patch: Partial<AppConfig>) => void;

/**
 * First-run setup. Shown once when `cfg.onboarded` is false:
 *  - set the disguise display name + avatar (this IS the fake AI-assistant identity)
 *  - a "关注作者" card (官网 / GitHub / 抖音)
 * Finishing sets `onboarded: true` so it never reappears. Not dismissible by
 * backdrop click — the user must finish (but may keep the default name).
 */
export class Onboarding {
  private overlay?: HTMLElement;
  private tempAvatar?: string;

  constructor(
    private cfg: AppConfig,
    private onDone: OnboardDoneFn
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
    const overlay = el('div', 'onboard-overlay');
    const modal = el('div', 'onboard-modal');

    modal.appendChild(el('div', 'onboard-title', `欢迎使用 ${BRAND.name}`));
    modal.appendChild(
      el(
        'div',
        'onboard-sub',
        '先设置一下「助手」的名字和头像 —— 这就是它伪装成的 AI 身份。建议设成你常用的 AI 工具(豆包 / Kimi / DeepSeek),看起来更自然。'
      )
    );

    // ---- avatar + name ----
    const idRow = el('div', 'set-id-row');
    const preview = el('div', 'avatar set-avatar-preview');
    this.setPreview(preview);

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
    const changeBtn = el('button', 'set-btn-ghost', '上传头像');
    changeBtn.addEventListener('click', () => fileInput.click());

    const idCol = el('div', 'set-id-col');
    const btns = el('div', 'set-avatar-btns');
    btns.appendChild(changeBtn);
    idCol.appendChild(btns);
    idCol.appendChild(fileInput);
    idRow.appendChild(preview);
    idRow.appendChild(idCol);
    const avatarWrap = el('div', 'onboard-avatar');
    avatarWrap.appendChild(el('div', 'set-label', '头像'));
    avatarWrap.appendChild(idRow);
    modal.appendChild(avatarWrap);

    const nameInput = el('input', 'set-input') as HTMLInputElement;
    nameInput.type = 'text';
    nameInput.value = this.cfg.avatarName;
    nameInput.placeholder = '助手名称,如:豆包';
    const nameWrap = el('div', 'onboard-name');
    nameWrap.appendChild(el('div', 'set-label', '显示名称'));
    nameWrap.appendChild(nameInput);
    nameWrap.appendChild(
      el('div', 'onboard-hint', '以后随时可点左上角头像 → 进入「设置」修改名字和头像。')
    );
    modal.appendChild(nameWrap);

    // ---- follow card ----
    const follow = el('div', 'onboard-follow');
    follow.appendChild(el('div', 'onboard-follow-tip', FOLLOW_PITCH));
    follow.appendChild(buildFollowLinks());
    modal.appendChild(follow);

    // ---- finish ----
    const foot = el('div', 'onboard-foot');
    const done = el('button', 'set-btn-primary', '开始使用');
    done.addEventListener('click', () => {
      this.onDone({
        avatarName: nameInput.value.trim() || '豆包',
        avatarDataUrl: this.tempAvatar,
        onboarded: true,
      });
      this.close();
    });
    foot.appendChild(done);
    modal.appendChild(foot);

    overlay.appendChild(modal);
    this.overlay = overlay;
  }
}
