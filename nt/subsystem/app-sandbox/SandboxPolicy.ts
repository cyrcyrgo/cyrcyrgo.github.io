/**
 * SandboxPolicy - Sandbox security policy for the WebNT-HTML5 Web OS Kernel.
 * Defines security levels and generates CSP/sandbox attributes.
 */

export enum PolicyLevel {
  RESTRICTED = 'RESTRICTED',
  STANDARD = 'STANDARD',
  ELEVATED = 'ELEVATED',
  TRUSTED = 'TRUSTED',
}

export interface PolicyDefinition {
  cpuLimit: number;
  memoryLimit: number;
  networkAccess: boolean;
  fileAccess: boolean;
  allowedAPIs: string[];
  allowScripts: boolean;
  allowSameOrigin: boolean;
  allowForms: boolean;
  allowPopups: boolean;
  allowModals: boolean;
  allowTopNavigation: boolean;
  allowPresentation: boolean;
  allowDownloads: boolean;
}

let _instance: SandboxPolicy | null = null;

export class SandboxPolicy {
  private policies: Map<PolicyLevel, PolicyDefinition> = new Map();

  static get instance(): SandboxPolicy {
    if (!_instance) {
      _instance = new SandboxPolicy();
    }
    return _instance;
  }

  private constructor() {
    this.initPolicies();
  }

  getPolicy(level: PolicyLevel): PolicyDefinition {
    const policy = this.policies.get(level);
    if (!policy) {
      return this.policies.get(PolicyLevel.STANDARD)!;
    }
    return { ...policy, allowedAPIs: [...policy.allowedAPIs] };
  }

  generateCSP(level: PolicyLevel): string {
    const policy = this.getPolicy(level);
    const directives: string[] = [];

    directives.push("default-src 'none'");

    if (policy.allowScripts) {
      directives.push("script-src 'self' 'unsafe-inline'");
    }

    directives.push("style-src 'self' 'unsafe-inline'");

    if (policy.networkAccess) {
      directives.push("connect-src 'self' https: wss:");
      directives.push("img-src 'self' data: blob: https:");
      directives.push("media-src 'self' blob:");
    } else {
      directives.push("connect-src 'self'");
      directives.push("img-src 'self' data:");
      directives.push("media-src 'self'");
    }

    if (policy.allowForms) {
      directives.push("form-action 'self'");
    }

    directives.push("frame-ancestors 'self'");
    directives.push("base-uri 'self'");
    directives.push("sandbox allow-scripts");

    return directives.join('; ');
  }

  generateSandboxAttrs(level: PolicyLevel): string {
    const policy = this.getPolicy(level);
    const attrs: string[] = [];

    if (policy.allowScripts) {
      attrs.push('allow-scripts');
    }
    if (policy.allowSameOrigin) {
      attrs.push('allow-same-origin');
    }
    if (policy.allowForms) {
      attrs.push('allow-forms');
    }
    if (policy.allowPopups) {
      attrs.push('allow-popups');
    }
    if (policy.allowModals) {
      attrs.push('allow-modals');
    }
    if (policy.allowTopNavigation) {
      attrs.push('allow-top-navigation');
    }
    if (policy.allowPresentation) {
      attrs.push('allow-presentation');
    }
    if (policy.allowDownloads) {
      attrs.push('allow-downloads');
    }

    return attrs.join(' ');
  }

  private initPolicies(): void {
    this.policies.set(PolicyLevel.RESTRICTED, {
      cpuLimit: 50,
      memoryLimit: 32 * 1024 * 1024,
      networkAccess: false,
      fileAccess: false,
      allowedAPIs: ['nt.getInfo'],
      allowScripts: true,
      allowSameOrigin: false,
      allowForms: false,
      allowPopups: false,
      allowModals: false,
      allowTopNavigation: false,
      allowPresentation: false,
      allowDownloads: false,
    });

    this.policies.set(PolicyLevel.STANDARD, {
      cpuLimit: 200,
      memoryLimit: 128 * 1024 * 1024,
      networkAccess: true,
      fileAccess: false,
      allowedAPIs: [
        'nt.getInfo',
        'nt.display.draw',
        'nt.display.measure',
        'nt.net.fetch',
        'nt.sys.getTime',
        'nt.sys.getEnv',
        'nt.fs.read',
        'nt.fs.write',
        'nt.storage.get',
        'nt.storage.set',
        'nt.notify.show',
      ],
      allowScripts: true,
      allowSameOrigin: true,
      allowForms: true,
      allowPopups: false,
      allowModals: true,
      allowTopNavigation: false,
      allowPresentation: false,
      allowDownloads: false,
    });

    this.policies.set(PolicyLevel.ELEVATED, {
      cpuLimit: 500,
      memoryLimit: 256 * 1024 * 1024,
      networkAccess: true,
      fileAccess: true,
      allowedAPIs: [
        'nt.getInfo',
        'nt.display.draw',
        'nt.display.measure',
        'nt.display.createLayer',
        'nt.net.fetch',
        'nt.net.ws',
        'nt.sys.getTime',
        'nt.sys.getEnv',
        'nt.sys.exec',
        'nt.fs.read',
        'nt.fs.write',
        'nt.fs.delete',
        'nt.fs.list',
        'nt.storage.get',
        'nt.storage.set',
        'nt.storage.delete',
        'nt.notify.show',
        'nt.clipboard.read',
        'nt.clipboard.write',
      ],
      allowScripts: true,
      allowSameOrigin: true,
      allowForms: true,
      allowPopups: true,
      allowModals: true,
      allowTopNavigation: false,
      allowPresentation: true,
      allowDownloads: true,
    });

    this.policies.set(PolicyLevel.TRUSTED, {
      cpuLimit: 1000,
      memoryLimit: 512 * 1024 * 1024,
      networkAccess: true,
      fileAccess: true,
      allowedAPIs: [
        'nt.getInfo',
        'nt.display.draw',
        'nt.display.measure',
        'nt.display.createLayer',
        'nt.display.composite',
        'nt.net.fetch',
        'nt.net.ws',
        'nt.net.tcp',
        'nt.sys.getTime',
        'nt.sys.getEnv',
        'nt.sys.exec',
        'nt.sys.register',
        'nt.fs.read',
        'nt.fs.write',
        'nt.fs.delete',
        'nt.fs.list',
        'nt.fs.mkdir',
        'nt.storage.get',
        'nt.storage.set',
        'nt.storage.delete',
        'nt.storage.clear',
        'nt.notify.show',
        'nt.clipboard.read',
        'nt.clipboard.write',
        'nt.process.spawn',
        'nt.process.kill',
        'nt.registry.read',
        'nt.registry.write',
      ],
      allowScripts: true,
      allowSameOrigin: true,
      allowForms: true,
      allowPopups: true,
      allowModals: true,
      allowTopNavigation: true,
      allowPresentation: true,
      allowDownloads: true,
    });
  }
}

export default SandboxPolicy;