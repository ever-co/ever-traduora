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
   *
   * @param payload
   * @returns
   */
  async validate(payload: JwtPayload) {
    let user: User | ProjectClient;
    switch (payload.type) {
      case 'user':
        user = await this.userRepository.findOne({
          where: { id: payload.sub },
          select: ['id', 'name', 'email', 'numProjectsCreated'],
        });
        break;
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
