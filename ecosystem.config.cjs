module.exports = {
  apps: [
    {
      name: "gleaptracker",
      script: "dist/src/server.js",
      cwd: "/var/www/gleaptracker",
      node_args: "-r dotenv/config",
      env: {
        DOTENV_CONFIG_PATH: "/var/www/gleaptracker/.env.local",
        PORT: "3005",
      },
    },
  ],
}
