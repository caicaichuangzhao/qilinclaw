import { EventEmitter } from 'events';

interface Session {
  id: string;
  agentId: string;
  conversationId: string;
  platform: string;
  channelId: string;
  createdAt: number;
  lastActivity: number;
}

interface MessageEvent {
  sessionId: string;
  agentId: string;
  conversationId: string;
  type: 'progress' | 'status' | 'question' | 'result';
  content: string;
  timestamp: number;
}

class GatewayService extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private agentSessions: Map<string, Set<string>> = new Map();
  private conversationSessions: Map<string, Set<string>> = new Map();

  createSession(agentId: string, conversationId: string, platform: string, channelId: string): string {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const session: Session = {
      id: sessionId,
      agentId,
      conversationId,
      platform,
      channelId,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    this.sessions.set(sessionId, session);

    if (!this.agentSessions.has(agentId)) {
      this.agentSessions.set(agentId, new Set());
    }
    this.agentSessions.get(agentId)!.add(sessionId);

    if (!this.conversationSessions.has(conversationId)) {
      this.conversationSessions.set(conversationId, new Set());
    }
    this.conversationSessions.get(conversationId)!.add(sessionId);

    console.log(`[Gateway] Created session ${sessionId} for agent ${agentId}, conversation ${conversationId}`);
    
    this.emit('session_created', session);
    
    return sessionId;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionsByAgent(agentId: string): Session[] {
    const sessionIds = this.agentSessions.get(agentId);
    if (!sessionIds) return [];
    
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((s): s is Session => s !== undefined);
  }

  getSessionsByConversation(conversationId: string): Session[] {
    const sessionIds = this.conversationSessions.get(conversationId);
    if (!sessionIds) return [];
    
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter((s): s is Session => s !== undefined);
  }

  sendMessage(sessionId: string, type: MessageEvent['type'], content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[Gateway] Session ${sessionId} not found`);
      return;
    }

    session.lastActivity = Date.now();

    const messageEvent: MessageEvent = {
      sessionId,
      agentId: session.agentId,
      conversationId: session.conversationId,
      type,
      content,
      timestamp: Date.now()
    };

    console.log(`[Gateway] Sending message to session ${sessionId}: [${type}] ${content}`);
    
    this.emit('message', messageEvent);
    
    this.emit(`message:${sessionId}`, messageEvent);
    this.emit(`message:agent:${session.agentId}`, messageEvent);
    this.emit(`message:conversation:${session.conversationId}`, messageEvent);
  }

  sendMessageToAgent(agentId: string, type: MessageEvent['type'], content: string): void {
    const sessions = this.getSessionsByAgent(agentId);
    sessions.forEach(session => {
      this.sendMessage(session.id, type, content);
    });
  }

  sendMessageToConversation(conversationId: string, type: MessageEvent['type'], content: string): void {
    const sessions = this.getSessionsByConversation(conversationId);
    sessions.forEach(session => {
      this.sendMessage(session.id, type, content);
    });
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);

    const agentSessionIds = this.agentSessions.get(session.agentId);
    if (agentSessionIds) {
      agentSessionIds.delete(sessionId);
      if (agentSessionIds.size === 0) {
        this.agentSessions.delete(session.agentId);
      }
    }

    const conversationSessionIds = this.conversationSessions.get(session.conversationId);
    if (conversationSessionIds) {
      conversationSessionIds.delete(sessionId);
      if (conversationSessionIds.size === 0) {
        this.conversationSessions.delete(session.conversationId);
      }
    }

    console.log(`[Gateway] Closed session ${sessionId}`);
    
    this.emit('session_closed', session);
  }

  closeAllSessions(): void {
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  cleanupInactiveSessions(maxInactiveTime: number = 3600000): void {
    const now = Date.now();
    const sessionsToClose: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > maxInactiveTime) {
        sessionsToClose.push(sessionId);
      }
    }

    sessionsToClose.forEach(sessionId => this.closeSession(sessionId));
    
    if (sessionsToClose.length > 0) {
      console.log(`[Gateway] Cleaned up ${sessionsToClose.length} inactive sessions`);
    }
  }
}

export const gatewayService = new GatewayService();

setInterval(() => {
  gatewayService.cleanupInactiveSessions();
}, 600000);
