import axios, { AxiosInstance } from "axios";

// The consumer-side API client. The Pact consumer test points this at the Pact
// mock server, so the contract is generated from how THIS client actually calls
// the API — not from hand-written request strings.

export interface Pet {
  id: string;
  name: string;
  species: string;
  age: number;
}

export interface NewPet {
  name: string;
  species: string;
  age: number;
}

export class PetsClient {
  private http: AxiosInstance;

  constructor(baseUrl: string) {
    // baseUrl points at the real provider in prod, or the Pact mock server in tests.
    this.http = axios.create({ baseURL: `${baseUrl}/api/v1` });
  }

  async listPets(): Promise<Pet[]> {
    const res = await this.http.get<Pet[]>("/pets");
    return res.data;
  }

  async getPet(id: string): Promise<Pet> {
    const res = await this.http.get<Pet>(`/pets/${id}`);
    return res.data;
  }

  async createPet(pet: NewPet): Promise<Pet> {
    const res = await this.http.post<Pet>("/pets", pet);
    return res.data;
  }
}
