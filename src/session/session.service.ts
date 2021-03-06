import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { plainToClass } from "class-transformer";
import { AccountEntity } from "src/account/entity/account.entity";
import { AssociateEntity } from "src/associate/entity/associate.entity";
import { ClientEntity } from "src/client/entity/client.entity";
import { DocEntity } from "src/doc/entity/doc.entity";
import { UserEntity } from "src/user/entity/user.entity";
import { WitnessEntity } from "src/witness/entity/witness.entity";
import { DeleteResult, Repository } from "typeorm";
import { CreateSessionDto } from "./dto/session.create-dto";
import { UpdateSessionDto } from "./dto/session.update-dto";
import { NotarySessionTypeEntity } from "./entity/notary.session.type.entity";
import { SessionAssociateJoinEntity } from "./entity/session.assoc.join.entity";
import { SessionEntity } from "./entity/session.entity";
import { SessionStatusEntity } from "./entity/session.status.entity";
import { SessionTypeEntity } from "./entity/session.types.entity";
import { v4 as uuid } from "uuid";
import { DurationEntity } from "src/duration/entity/duration.entity";
import { LessThan, MoreThan } from 'typeorm'
import { S3 } from 'aws-sdk';
import { emptyS3Directory } from "src/providers/utils";
import { MSGTYPE, SessionTokenEntity } from "./entity/session.token.entity";
import { SmsService } from "src/sms/sms.service";
import { JwtService } from '@nestjs/jwt';
import { LoginSessionDto } from "./dto/session.login-dto";
import { SGEmailService } from "src/sendgrid/sendgrid.service";

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(SessionEntity)
    private sessionRepository: Repository<SessionEntity>,
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @InjectRepository(DurationEntity)
    private durationRepository: Repository<DurationEntity>,
    @InjectRepository(SessionTypeEntity)
    private sTypeRepository: Repository<SessionTypeEntity>,
    @InjectRepository(SessionStatusEntity)
    private sStatusRepository: Repository<SessionStatusEntity>,
    @InjectRepository(NotarySessionTypeEntity)
    private nSessionTypeRepository: Repository<NotarySessionTypeEntity>,
    @InjectRepository(ClientEntity)
    private clientRepository: Repository<ClientEntity>,
    @InjectRepository(WitnessEntity)
    private witnessRepository: Repository<WitnessEntity>,
    @InjectRepository(AssociateEntity)
    private associateRepository: Repository<AssociateEntity>,
    @InjectRepository(DocEntity)
    private docRepository: Repository<DocEntity>,
    @InjectRepository(SessionAssociateJoinEntity)
    private sajRepository: Repository<SessionAssociateJoinEntity>,
    @InjectRepository(SessionTokenEntity)
    private stRepository: Repository<SessionTokenEntity>,
    private smsSerivce: SmsService,
    private sgEmailService: SGEmailService,
    private jwtService: JwtService
  ) { }

  async findAllSessions(): Promise<SessionEntity[]> {
    return await this.sessionRepository.find({ relations: ["account", "user", "sessionType", "sessionStatus", "notarySessionType", "clients", "witnesses", "sessionAssociateJoins", "sessionAssociateJoins.associate", "sessionAssociateJoins.user", "docs"] });
  }

  async findSessionById(id: number): Promise<SessionEntity> {
    return await this.sessionRepository.findOne({ id }, { relations: ["account", "user", "sessionType", "sessionStatus", "notarySessionType", "clients", "witnesses", "sessionAssociateJoins", "sessionAssociateJoins.associate", "sessionAssociateJoins.user", "docs"] });
  }

  async createSession(session: CreateSessionDto): Promise<SessionEntity> {
    const {
      account,
      user,
      duration,
      dateTime,
      sessionType,
      sessionStatus,
      notarySessionType,
      clientIds,
      witnessIds,
      associateIds,
      assocUserIds,
      docIds,
      ...dto
    } = session;
    const sAccount = await this.accountRepository.findOne({
      id: account,
    }, {
      relations: ['timezone'],
    });
    let calcDateTime = dateTime;
    if (sAccount) {
      calcDateTime -= sAccount.timezone.offset * 60 * 60 * 1000;
    }

    const s3 = new S3();
    const sessionEnt = await this.sessionRepository.save({
      hash: uuid(),
      account: sAccount,
      dateTime: calcDateTime,
      user: await this.userRepository.findOne({
        id: user,
      }),
      duration: await this.durationRepository.findOne({
        id: duration,
      }),
      sessionType: await this.sTypeRepository.findOne({
        id: sessionType,
      }),
      sessionStatus: await this.sStatusRepository.findOne({
        id: sessionStatus,
      }),
      notarySessionType: await this.nSessionTypeRepository.findOne({
        id: notarySessionType,
      }),
      clients: await this.clientRepository.findByIds(clientIds || []),
      witnesses: await this.witnessRepository.findByIds(witnessIds || []),
      docs: await this.docRepository.findByIds(docIds || []),
      ...dto
    });
    await this.patchAssocitateRelations(sessionEnt, true, assocUserIds)
    await this.patchAssocitateRelations(sessionEnt, false, associateIds)

    sessionEnt.clients.map(async client => {
      emptyS3Directory(`${client.id}/${sessionEnt.hash}/`)
      const createFolderRes = await s3.upload({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: `${client.id}/${sessionEnt.hash}/`,
        Body: ''
      }).promise();
    })
    return sessionEnt;
  }

  async updateSessionById(id: number, updateSessionDto: UpdateSessionDto): Promise<SessionEntity> {
    const session = await this.sessionRepository.findOne(id);
    if (!session)
      throw new NotFoundException(`there is no Session with ID ${id}`);

    const {
      account,
      user,
      duration,
      sessionType,
      sessionStatus,
      notarySessionType,
      clientIds,
      witnessIds,
      associateIds,
      assocUserIds,
      docIds,
      ...dto
    } = updateSessionDto;

    if (account) {
      dto['account'] = await this.accountRepository.findOne({
        id: account,
      });
    }

    if (user) {
      dto['user'] = await this.userRepository.findOne({
        id: user,
      });
    }

    if (duration) {
      dto['duration'] = await this.durationRepository.findOne({
        id: duration,
      });
    }

    if (sessionType) {
      dto['sessionType'] = await this.sTypeRepository.findOne({
        id: sessionType,
      });
    }

    if (sessionStatus) {
      dto['sessionStatus'] = await this.sStatusRepository.findOne({
        id: sessionStatus,
      });
    }

    if (notarySessionType) {
      dto['notarySessionType'] = await this.nSessionTypeRepository.findOne({
        id: notarySessionType,
      });
    }

    if (clientIds) {
      dto['clients'] = await this.clientRepository.findByIds(clientIds || []);
    }

    if (witnessIds) {
      dto['witnesses'] = await this.witnessRepository.findByIds(witnessIds || []);
    }

    if (associateIds) {
      await this.patchAssocitateRelations(session, false, associateIds)
    }

    if (assocUserIds) {
      await this.patchAssocitateRelations(session, true, assocUserIds)
    }

    if (docIds) {
      dto['docs'] = await this.docRepository.findByIds(docIds || []);
    }

    return await this.sessionRepository.save(plainToClass(SessionEntity, { ...session, ...dto }));
  }

  async removeSessionById(id: number): Promise<SessionEntity> {
    const session = await this.sessionRepository.findOne(id, { relations: ["clients"] });
    if (!session)
      throw new NotFoundException(`there is no Session with ID ${id}`);
    session.clients.map(async client => {
      emptyS3Directory(`${client.id}/${session.hash}/`)
    })
    return await this.sessionRepository.remove(session);
  }

  async patchAssocitateRelations(session: SessionEntity, isUser: boolean, ids: Array<number>) {
    if (isUser) {
      (ids || []).map(async (id) => {
        const user = await this.userRepository.findOne(id);
        if (user) {
          await this.sajRepository.save({
            isUser,
            session,
            user,
          });
        }
      });
    }
    else {
      (ids || []).map(async (id) => {
        const associate = await this.associateRepository.findOne(id);
        if (associate) {
          await this.sajRepository.save({
            isUser,
            session,
            associate,
          });
        }
      });
    }
  }

  checkSessionTimeout = async () => {
    const hrs24Before = Math.floor((Date.now() - (24 * 60 * 60 * 1000)) / 1000);
    const sessions: SessionEntity[] = await this.sessionRepository.find({
      relations: ['sessionStatus'],
      where: {
        sessionStatus: {
          status: true
        },
        dateTime: LessThan(hrs24Before)
      }
    });

    sessions.forEach(async (session) => {
      await this.sStatusRepository.save(plainToClass(SessionStatusEntity, {
        ...session.sessionStatus,
        status: false,
      }))
    })
  }

  // SESSION AUTH
  // 1. GENERATE PIN CODE
  // 2. LOGIN BY PIN NUMBER AND GENERATE TOKEN(1d valid)
  // 3  REFRESH TOKEN BY PREVIOUS VALID TOKEN
  // 4. SESSION GET ACCESS LIMITED ONLY HAS_TOKEN REQUEST

  // CRON JOB FOR SENDING 6-DIGITS PIN CODE WHEN SESSION IS STARTED 
  digitPinGen() {
    var chars = 'acdefhiklmnoqrstuvwxyz0123456789'.split('');
    var result = '';
    for (var i = 0; i < 6; i++) {
      var x = Math.floor(Math.random() * chars.length);
      result += chars[x];
    }
    return result;
  }

  sendVerifDigitPin = async () => {
    this.removePassedSessionTokens();

    const hrs24Before = Math.floor((Date.now() - (24 * 60 * 60 * 1000)) / 1000);
    const mins15After = Math.floor((Date.now() + (15 * 60 * 1000)) / 1000);

    const sessions: SessionEntity[] = await this.sessionRepository.find({
      relations: ['sessionStatus', 'account', 'clients', 'witnesses', 'sessionAssociateJoins', 'sessionAssociateJoins.associate', 'tokens'],
      where: {
        sessionStatus: {
          status: true
        },
        dateTime: MoreThan(hrs24Before) && LessThan(mins15After)
      }
    });
    sessions.forEach((session) => {
      session.clients.map(async (client: ClientEntity) => {
        const sessionTokens = await Promise.all((await this.stRepository.find({
          clientId: client.id,
          session,
        })).map(async st => await this.updateDeliverStatus(st)));
        const isDelivered = sessionTokens.find(st => st.isDelivered)
        if (!isDelivered) {
          const digitPin = this.digitPinGen();
          await this.handleSendPinViaSMS({
            clientId: client.id,
            session,
            msgType: MSGTYPE.SMS
          }, client.phone, digitPin)
          await this.handleSendPinViaEmail({
            clientId: client.id,
            session,
            msgType: MSGTYPE.EMAIL
          }, client.email, digitPin)
        }
      })
      session.witnesses.map(async witness => {
        const sessionTokens = await Promise.all((await this.stRepository.find({
          relations: ['session'],
          where: {
            witnessId: witness.id,
            session,
          }
        })).map(async st => await this.updateDeliverStatus(st)));
        const isDelivered = sessionTokens.find(st => st.isDelivered)
        if (!isDelivered) {
          const digitPin = this.digitPinGen();
          await this.handleSendPinViaSMS({
            witnessId: witness.id,
            session,
            msgType: MSGTYPE.SMS
          }, witness.phone, digitPin)
          await this.handleSendPinViaEmail({
            witnessId: witness.id,
            session,
            msgType: MSGTYPE.EMAIL
          }, witness.email, digitPin)
        }
      })
      session.sessionAssociateJoins.map(async sa => {
        const associate = sa.associate;
        const sessionTokens = await Promise.all((await this.stRepository.find({
          associateId: associate.id,
          session,
        })).map(async st => await this.updateDeliverStatus(st)));
        const isDelivered = sessionTokens.find(st => st.isDelivered)
        if (!isDelivered) {
          const digitPin = this.digitPinGen();
          await this.handleSendPinViaSMS({
            associateId: associate.id,
            session,
            msgType: MSGTYPE.SMS
          }, associate.phone, digitPin)
          await this.handleSendPinViaEmail({
            associateId: associate.id,
            session,
            msgType: MSGTYPE.EMAIL
          }, associate.email, digitPin)
        }
      })
    })
  }

  updateDeliverStatus = async (sessionToken: SessionTokenEntity) => {
    if (sessionToken.msgType === MSGTYPE.EMAIL) {
      // const feedback = await this.sgEmailService.getFeedbackMsg(sessionToken.deliveryMessageSid)
      // TODO update session_token checken by feedback status
    } else {
      const feedback = await this.smsSerivce.getFeedbackMsg(sessionToken.deliveryMessageSid)
      if (feedback && feedback?.outcome === 'confirmed') {
        const newSt = await this.stRepository.save(plainToClass(SessionTokenEntity, {
          ...sessionToken,
          deliveryStatus: 'confirmed',
          isDelivered: true
        }))
        return newSt;
      }
    }
    return sessionToken;
  }

  handleSendPinViaSMS = async (initalData: any, phoneNumber: string, digitPin: string) => {
    const res = await this.smsSerivce.initiatePhoneNumberVerification(phoneNumber, digitPin, initalData.session)

    const oldSt = await this.stRepository.findOne({
      ...initalData
    });
    await this.stRepository.save(plainToClass(SessionTokenEntity, {
      ...(oldSt ? oldSt : initalData),
      pin: res.digitPin,
      deliveryMessageSid: res.status?.sid,
      deliveryStatus: res.status?.status || '',
      isDelivered: res.status?.status === 'sent'
    }))
  }

  handleSendPinViaEmail = async (initalData: any, email: string, digitPin: string) => {
    const res = await this.sgEmailService.initiateEmailVerification(email, digitPin, initalData.session)

    const oldSt = await this.stRepository.findOne({
      ...initalData
    });
    await this.stRepository.save(plainToClass(SessionTokenEntity, {
      ...(oldSt ? oldSt : initalData),
      pin: digitPin,
      deliveryMessageSid: res?.headers['x-message-id'],
      deliveryStatus: 'Processed',
      isDelivered: false
    }))
  }

  // REMOVE SESSION TOKENS ALREADY PASSED AWAY NOW
  removePassedSessionTokens = async () => {
    const hrs24Before = Math.floor((Date.now() - (24 * 60 * 60 * 1000)) / 1000);
    const passedSessions = await this.sessionRepository.find({
      relations: ['tokens'],
      where: {
        dateTime: LessThan(hrs24Before)
      }
    });
    passedSessions.forEach(async (ps: SessionEntity) => {
      await this.stRepository.remove(ps.tokens)
    })
  }

  // LOGIN BY PIN NUMBER
  loginByPinDigits = async (dto: LoginSessionDto) => {
    const dbToken = await this.stRepository.findOne({
      pin: dto.pin
    });
    if (!dbToken) {
      throw new UnauthorizedException("pin is wrong");
    }
    if (dbToken.token && this.checkIfTokenValid(dbToken.token)) {
      return {
        accessToken: dbToken.token
      }
    }
    const updatedDBToken = await this.generateToken(dbToken);
    if (!updatedDBToken) {
      throw new UnauthorizedException("pin is wrong");
    }
    return {
      accessToken: updatedDBToken.token
    }
  }

  // GENERATE TOKEN AFTER LOGGED IN BY PIN NUMBER
  generateToken = async (dbToken: SessionTokenEntity) => {
    const hrs24After = Date.now() + (24 * 60 * 60 * 1000);
    if (dbToken.clientId) {
      const client = await this.clientRepository.findOne({
        id: dbToken.clientId,
      });
      if (!client) {
        return false;
      }
      const { ...plainClient } = client;
      return await this.stRepository.save(plainToClass(SessionTokenEntity, {
        ...dbToken,
        token: this.jwtService.sign(plainClient, {
          expiresIn: '1d'
        }),
        timeoutAt: hrs24After,
      }))
    }
    if (dbToken.witnessId) {
      const witness = await this.witnessRepository.findOne({
        id: dbToken.witnessId,
      });
      if (!witness) {
        return false;
      }
      const { ...plainWitness } = witness;
      return await this.stRepository.save(plainToClass(SessionTokenEntity, {
        ...dbToken,
        token: this.jwtService.sign(plainWitness, {
          expiresIn: '1d'
        }),
        timeoutAt: hrs24After,
      }))
    }
    if (dbToken.associateId) {
      const assoc = await this.associateRepository.findOne({
        id: dbToken.associateId,
      });
      if (!assoc) {
        return false;
      }
      const { ...plainAssoc } = assoc;
      return await this.stRepository.save(plainToClass(SessionTokenEntity, {
        ...dbToken,
        token: this.jwtService.sign(plainAssoc, {
          expiresIn: '1d'
        }),
        timeoutAt: hrs24After,
      }))
    }
  }

  generateRefreshToken = async (token) => {
    const dbToken = await this.getIfTokenValid(token);
    if (!dbToken) {
      throw new UnauthorizedException('Invalid token');
    }
    const updatedDBToken = await this.generateToken(dbToken);
    if (!updatedDBToken) {
      throw new UnauthorizedException("pin is wrong");
    }
    return updatedDBToken.token;
  }

  // CHECK IF TOKEN VALID
  getIfTokenValid = async (token) => {
    try {
      const decoded = this.jwtService.decode(token);
      if (!decoded) {
        return false;
      }
      const dbToken = await this.stRepository.findOne({
        token
      })
      if (!dbToken) {
        return false;
      }
      if (parseInt(dbToken.timeoutAt) < Date.now()) {
        return false;
      }
      return dbToken;
    } catch {
      return false;
    }
  }

  // CHECK IF TOKEN VALID
  checkIfTokenValid = async (token) => {
    const dbToken = await this.getIfTokenValid(token);
    if (dbToken) return true;
    return false;
  }
}
