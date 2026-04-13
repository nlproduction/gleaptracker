module.exports = {
  apps: [
    {
      name: "gleaptracker",
      script: "dist/src/server.js",
      cwd: ".",
      node_args: "-r dotenv/config",
      env: {
        DOTENV_CONFIG_PATH: ".env.local",
        PORT: "3005",
      },
    },
  ],
};
