import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { config } from '../config';
import { JwtPayload } from '../domain/http';
import { ProjectClient } from '../entity/project-client.entity';
import { User } from '../entity/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(ProjectClient) private readonly projectClientRepository: Repository<ProjectClient>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.secret,
    });
  }

  /**
   * Validates a JWT payload to authenticate a user or project client based on the payload type.
   * Retrieves the associated `User` or `ProjectClient` entity from the database and returns it if found.
   * Throws an `UnauthorizedException` if no corresponding entity is found for the given payload.
   *
   * @param {JwtPayload} payload - The JWT payload containing the subject ID and type (user or client).
   * @returns {Promise<User | ProjectClient>} - Returns a promise that resolves to a `User` or `ProjectClient` entity.
   * @throws {UnauthorizedException} - If no user or client is found for the provided payload.
   */
  async validate(payload: JwtPayload): Promise<User | ProjectClient> {
    let user: User | ProjectClient | null = null;

    switch (payload.type) {
      case 'user': {
        const found = await this.userRepository.findOne({
          where: { id: payload.sub },
          select: ['id', 'name', 'email', 'emailVerified', 'numProjectsCreated', 'sessionVersion'],
        });
        // Tokens of an ended session version no longer work, e.g. after a password reset
        if (found && (payload.sv ?? 0) !== found.sessionVersion) {
          throw new UnauthorizedException();
        }
        if (found) {
          // Keep the User instance (authorization checks instanceof), but not this field: /users/me returns the object
          delete found.sessionVersion;
          user = found;
        }
        break;
      }

      case 'client':
        user = await this.projectClientRepository.findOne({
          where: { id: payload.sub },
          select: ['id'],
        });
        break;

      default:
        break;
    }

    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }
}
