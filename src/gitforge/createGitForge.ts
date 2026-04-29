import type { AppConfig } from "../config.ts";
import type { GitForge } from "./GitForge.ts";
import { GiteaHttpForge } from "./GiteaHttpForge.ts";
import { MockGiteaForge } from "./MockGiteaForge.ts";

export function createGitForge(config: AppConfig): GitForge {
  if (config.gitForge === "gitea") {
    if (!config.giteaToken) {
      throw new Error("GITEA_TOKEN is required when GIT_FORGE=gitea");
    }

    return new GiteaHttpForge({
      baseUrl: config.giteaBaseUrl,
      token: config.giteaToken,
      rootOwner: config.giteaRootOwner,
      rootOwnerType: config.giteaRootOwnerType,
      sshUser: config.giteaSshUser,
      sshHost: config.giteaSshHost,
      sshPort: config.giteaSshPort
    });
  }

  return new MockGiteaForge({
    sshHost: config.giteaSshHost,
    sshPort: config.giteaSshPort,
    rootOwner: config.giteaRootOwner
  });
}
