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
    @InjectRepository(ProjectClient) private readonly projectClientRepo: Repository<ProjectClient>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.secret,
    });
  }

  async validate(payload: JwtPayload) {
    let user: User | ProjectClient;
    switch (payload.type) {
      case 'user':
        user = await this.userRepo.findOne(payload.sub, {
          select: ['id', 'name', 'email', 'numProjectsCreated'],
        });
        break;
      case 'client':
        user = await this.projectClientRepo.findOne(payload.sub, {
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
