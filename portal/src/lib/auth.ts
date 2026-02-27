import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js';

// Lazy initialization to avoid prerender crashes when env vars don't exist
let userPool: CognitoUserPool | null = null;

function getUserPool(): CognitoUserPool {
  if (!userPool) {
    const userPoolId = process.env.NEXT_PUBLIC_USER_POOL_ID!;
    const clientId = process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!;
    
    userPool = new CognitoUserPool({
      UserPoolId: userPoolId,
      ClientId: clientId,
    });
  }
  return userPool;
}

export interface SignUpParams {
  email: string;
  password: string;
}

export interface SignInParams {
  email: string;
  password: string;
}

export interface VerifyParams {
  email: string;
  code: string;
}

export async function signUp({ email, password }: SignUpParams): Promise<void> {
  return new Promise((resolve, reject) => {
    const attributeList = [
      new CognitoUserAttribute({
        Name: 'email',
        Value: email,
      }),
    ];

    getUserPool().signUp(email, password, attributeList, [], (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export async function signIn({ email, password }: SignInParams): Promise<string> {
  return new Promise((resolve, reject) => {
    const authenticationData = {
      Username: email,
      Password: password,
    };

    const authenticationDetails = new AuthenticationDetails(authenticationData);

    const userData = {
      Username: email,
      Pool: getUserPool(),
    };

    const cognitoUser = new CognitoUser(userData);

    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (result) => {
        const idToken = result.getIdToken().getJwtToken();
        resolve(idToken);
      },
      onFailure: (err) => {
        reject(err);
      },
    });
  });
}

export async function verifyEmail({ email, code }: VerifyParams): Promise<void> {
  return new Promise((resolve, reject) => {
    const userData = {
      Username: email,
      Pool: getUserPool(),
    };

    const cognitoUser = new CognitoUser(userData);

    cognitoUser.confirmRegistration(code, true, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function getCurrentUser(): CognitoUser | null {
  return getUserPool().getCurrentUser();
}

export async function getIdToken(): Promise<string | null> {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    return null;
  }

  return new Promise((resolve, reject) => {
    currentUser.getSession((err: any, session: any) => {
      if (err) {
        reject(err);
        return;
      }
      if (session && session.isValid()) {
        resolve(session.getIdToken().getJwtToken());
      } else {
        resolve(null);
      }
    });
  });
}

export function signOut(): void {
  const currentUser = getCurrentUser();
  if (currentUser) {
    currentUser.signOut();
  }
}
