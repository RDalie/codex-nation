import { loadConfig } from "../config.ts";
import { GiteaHttpForge } from "./GiteaHttpForge.ts";

const config = loadConfig();

if (!config.giteaToken) {
  console.error("GITEA_TOKEN is required for gitea:doctor");
  process.exitCode = 1;
} else {
  const forge = new GiteaHttpForge({
    baseUrl: config.giteaBaseUrl,
    token: config.giteaToken,
    rootOwner: config.giteaRootOwner,
    rootOwnerType: config.giteaRootOwnerType,
    sshUser: config.giteaSshUser,
    sshHost: config.giteaSshHost,
    sshPort: config.giteaSshPort
  });

  const result = await forge.doctor();
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl: config.giteaBaseUrl,
        version: result.version,
        user: result.user,
        isAdmin: result.isAdmin,
        rootOwner: result.rootOwner,
        rootOwnerType: result.rootOwnerType,
        sshCloneBase:
          config.giteaSshPort === 22
            ? `${config.giteaSshUser}@${config.giteaSshHost}:OWNER/REPO.git`
            : `ssh://${config.giteaSshUser}@${config.giteaSshHost}:${config.giteaSshPort}/OWNER/REPO.git`
      },
      null,
      2
    )
  );
}
