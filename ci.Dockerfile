FROM node:lts

# Setup Rust to build Solana
RUN curl https://sh.rustup.rs -sSf | \
  sh -s -- --default-toolchain stable -y
ENV PATH=$PATH:/root/.cargo/bin

# Install Solana to enable running test suite
RUN sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
ENV PATH=$PATH:/root/.local/share/solana/install/active_release/bin/

WORKDIR /usr/src/app

# Install JS/TS deps
COPY package.json ./
COPY yarn.lock ./
RUN yarn

COPY . .

# Setup dummy solana keypair for building and testing
RUN solana-keygen new ----no-bip39-passphrase --silent

CMD ["yarn","test"]