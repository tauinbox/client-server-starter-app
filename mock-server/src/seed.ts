import type { MockUser, OAuthAccount } from './types';

const firstNames = [
  'Alex',
  'Maria',
  'David',
  'Elena',
  'Michael',
  'Sofia',
  'Daniel',
  'Anna',
  'James',
  'Laura',
  'Robert',
  'Emma',
  'William',
  'Olivia',
  'Thomas',
  'Mia',
  'Carlos',
  'Natalia',
  'Andrei',
  'Victoria',
  'Sergei',
  'Irina',
  'Pavel',
  'Yulia',
  'Dmitry',
  'Tatiana',
  'Nikolai',
  'Ekaterina',
  'Ivan',
  'Olga',
  'Peter',
  'Svetlana',
  'Anton',
  'Alina',
  'Viktor',
  'Daria',
  'Maxim',
  'Polina',
  'Artem',
  'Kristina',
  'Roman',
  'Vera',
  'Denis',
  'Nina',
  'Oleg',
  'Lydia',
  'Igor',
  'Galina',
  'Alexei',
  'Tamara',
  'Yuri',
  'Nadya',
  'Konstantin',
  'Larisa',
  'Mikhail',
  'Valentina',
  'Georgy',
  'Marina',
  'Evgeny',
  'Ksenia',
  'Vladislav',
  'Inna',
  'Stanislav',
  'Diana',
  'Timur'
];

const lastNames = [
  'Anderson',
  'Martinez',
  'Johnson',
  'Garcia',
  'Brown',
  'Lopez',
  'Davis',
  'Hernandez',
  'Miller',
  'Moore',
  'Taylor',
  'Jackson',
  'Martin',
  'Lee',
  'Thompson',
  'White',
  'Harris',
  'Clark',
  'Lewis',
  'Robinson',
  'Walker',
  'Young',
  'Allen',
  'King',
  'Wright',
  'Hill',
  'Scott',
  'Green',
  'Adams',
  'Baker',
  'Nelson',
  'Carter',
  'Mitchell',
  'Perez',
  'Roberts',
  'Turner',
  'Phillips',
  'Campbell',
  'Parker',
  'Evans',
  'Edwards',
  'Collins',
  'Stewart',
  'Sanchez',
  'Morris',
  'Rogers',
  'Reed',
  'Cook',
  'Morgan',
  'Bell',
  'Murphy',
  'Bailey',
  'Rivera',
  'Cooper',
  'Richardson',
  'Cox',
  'Howard',
  'Ward',
  'Torres',
  'Peterson',
  'Gray',
  'Ramirez',
  'Watson',
  'Brooks',
  'Kelly'
];

function generateUsers(): MockUser[] {
  const manual: MockUser[] = [
    {
      id: '1',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      password: 'Password1',
      isActive: true,
      isAdmin: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    },
    {
      id: '2',
      email: 'user@example.com',
      firstName: 'Regular',
      lastName: 'User',
      password: 'Password1',
      isActive: true,
      isAdmin: false,
      createdAt: '2025-01-15T00:00:00.000Z',
      updatedAt: '2025-01-15T00:00:00.000Z'
    },
    {
      id: '3',
      email: 'john@example.com',
      firstName: 'John',
      lastName: 'Smith',
      password: 'Password1',
      isActive: true,
      isAdmin: false,
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-01T00:00:00.000Z'
    },
    {
      id: '4',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      password: 'Password1',
      isActive: false,
      isAdmin: false,
      createdAt: '2025-03-01T00:00:00.000Z',
      updatedAt: '2025-03-01T00:00:00.000Z'
    },
    {
      id: '5',
      email: 'bob@example.com',
      firstName: 'Bob',
      lastName: 'Wilson',
      password: 'Password1',
      isActive: true,
      isAdmin: false,
      createdAt: '2025-04-01T00:00:00.000Z',
      updatedAt: '2025-04-01T00:00:00.000Z'
    }
  ];

  const generated: MockUser[] = [];
  for (let i = 0; i < 65; i++) {
    const id = String(i + 6);
    const firstName = firstNames[i];
    const lastName = lastNames[i];
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`;
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((i % 12) + 1).padStart(2, '0');
    generated.push({
      id,
      email,
      firstName,
      lastName,
      password: 'Password1',
      isActive: i % 5 !== 0,
      isAdmin: i % 20 === 0,
      createdAt: `2025-${month}-${day}T00:00:00.000Z`,
      updatedAt: `2025-${month}-${day}T00:00:00.000Z`
    });
  }

  return [...manual, ...generated];
}

export const seedUsers: MockUser[] = generateUsers();

export const seedOAuthAccounts: Map<string, OAuthAccount[]> = new Map([
  [
    '1',
    [
      {
        provider: 'google',
        providerId: 'google-admin-123',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]
  ]
]);
