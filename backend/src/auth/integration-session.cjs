const { JwtService } = require('@nestjs/jwt');

async function createAccessToken(prisma, userId, secret) {
  const session = await prisma.authSession.create({ data: { userId, version: 0, refreshTokenHash: 'integration-fixture', expiresAt: new Date(Date.now() + 5 * 60 * 1000) } });
  return new JwtService().sign({ sub: userId, sid: session.id }, { secret, expiresIn: '5m' });
}

module.exports = { createAccessToken };
