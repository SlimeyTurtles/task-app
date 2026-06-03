import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained runtime bundle for the Docker image — copies only the
  // server files + traced deps, ~80% smaller than shipping node_modules.
  output: "standalone",
};

export default nextConfig;
