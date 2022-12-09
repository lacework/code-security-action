FROM ubuntu:22.04
COPY . ./
RUN apt-get update
RUN apt-get install -y curl
RUN curl -sL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs
RUN npm install -g npm@latest
RUN npm install --omit=dev
RUN curl https://raw.githubusercontent.com/lacework/go-sdk/main/cli/install.sh | bash
ENTRYPOINT ["/docker-entrypoint.sh"]
