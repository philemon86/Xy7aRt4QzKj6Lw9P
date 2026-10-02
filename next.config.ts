import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  basePath: '/pos',
  trailingSlash: true,
  async redirects() {
    return [
      { source: '/', destination: '/pos', permanent: false, basePath: false },
      {
        source: '/:tenant([a-zA-Z]{2}[0-9]{2})',
        destination: '/pos/:tenant',
        permanent: false,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;
