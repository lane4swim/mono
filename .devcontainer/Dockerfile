# .devcontainer/Dockerfile
#
# Stellt sicher, dass der Standardbenutzer "node" des Basis-Images
# passwortlosen sudo-Zugriff hat — Voraussetzung für scripts/setup-codespace.sh
# und die manuellen Schritte aus docs/deployment-github-codespaces.md, die an
# vielen Stellen "sudo" ohne Passwortabfrage erwarten (analog zum
# vorkonfigurierten "vscode"-Benutzer im Standard-Codespaces-Image).
FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

RUN echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node \
  && chmod 0440 /etc/sudoers.d/node
