FROM ubuntu:22.04
COPY . ./
RUN apt-get update
RUN apt-get install -y curl
RUN curl -Lo /usr/local/bin/bazelisk https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-linux-amd64 && \
    chmod +x /usr/local/bin/bazelisk
RUN curl -sL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs
RUN npm install -g npm@latest
RUN npm install
RUN npm run compile
RUN curl https://raw.githubusercontent.com/lacework/go-sdk/main/cli/install.sh | bash
ENTRYPOINT ["/docker-entrypoint.sh"]
