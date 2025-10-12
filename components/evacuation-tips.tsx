"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AlertTriangle, MapPin, Phone, Users, Home, Package, ExternalLink } from "lucide-react"

export function EvacuationTips() {
  const evacuationCenters = [
    { name: "East Rembo Elementary School", address: "C. Raymundo Ave", distance: "0.5 km", phone: "(02) 8123-4567" },
    {
      name: "Barangay Hall Multi-Purpose Center",
      address: "Main St, East Rembo",
      distance: "0.8 km",
      phone: "(02) 8234-5678",
    },
    { name: "East Rembo Covered Court", address: "Sports Complex Rd", distance: "1.2 km", phone: "(02) 8345-6789" },
  ]

  const emergencyContacts = [
    { name: "Barangay Emergency Hotline", number: "8888-REMBO (73626)", available: "24/7" },
    { name: "BDRRM Office", number: "(02) 8123-4567", available: "24/7" },
    { name: "Taguig DRRM", number: "8789-3200", available: "24/7" },
    { name: "Red Cross Taguig", number: "143", available: "24/7" },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            <CardTitle>Flood Safety Guidelines</CardTitle>
          </div>
          <CardDescription>Essential information for flood preparedness and evacuation</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Package className="h-4 w-4" />
                Before the Flood
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Prepare an emergency kit with food, water, medicine, and important documents</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Keep mobile phones fully charged and have power banks ready</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Store valuables and electronics in elevated areas</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Know the location of nearest evacuation centers</span>
                </li>
              </ul>
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Home className="h-4 w-4" />
                During the Flood
              </h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Move to higher ground immediately when water starts rising</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Avoid walking or driving through floodwater</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Turn off electricity and gas if instructed to evacuate</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Follow official evacuation orders from authorities</span>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-blue-500" />
            <CardTitle>Evacuation Centers</CardTitle>
          </div>
          <CardDescription>Designated safe locations during flood emergencies</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {evacuationCenters.map((center, index) => (
              <div
                key={index}
                className="flex items-start justify-between gap-3 p-3 border rounded-lg hover:bg-accent transition-colors"
              >
                <div className="flex-1 space-y-1">
                  <p className="font-semibold text-sm">{center.name}</p>
                  <p className="text-xs text-muted-foreground">{center.address}</p>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-primary font-medium">{center.distance} away</span>
                    <a href={`tel:${center.phone}`} className="flex items-center gap-1 hover:underline">
                      <Phone className="h-3 w-3" />
                      {center.phone}
                    </a>
                  </div>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <a
                    href={`https://www.google.com/maps/search/${encodeURIComponent(center.name + " " + center.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-green-500" />
            <CardTitle>Emergency Contacts</CardTitle>
          </div>
          <CardDescription>24/7 hotlines for immediate assistance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {emergencyContacts.map((contact, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent transition-colors"
              >
                <div className="space-y-1">
                  <p className="font-semibold text-sm">{contact.name}</p>
                  <p className="text-xs text-muted-foreground">{contact.available}</p>
                </div>
                <Button size="sm" asChild className="touch-manipulation">
                  <a href={`tel:${contact.number.replace(/[^0-9]/g, "")}`}>
                    <Phone className="h-3 w-3 mr-2" />
                    {contact.number}
                  </a>
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-purple-500" />
            <CardTitle>Community Support</CardTitle>
          </div>
          <CardDescription>Additional resources and assistance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button variant="outline" className="h-auto flex-col items-start gap-2 p-4 bg-transparent" asChild>
              <a href="https://www.facebook.com/groups/eastrembo" target="_blank" rel="noopener noreferrer">
                <span className="font-semibold">East Rembo Community Group</span>
                <span className="text-xs text-muted-foreground">Join for real-time updates and community support</span>
              </a>
            </Button>
            <Button variant="outline" className="h-auto flex-col items-start gap-2 p-4 bg-transparent" asChild>
              <a href="tel:8888-73626">
                <span className="font-semibold">Report Emergency</span>
                <span className="text-xs text-muted-foreground">Call 8888-REMBO for immediate assistance</span>
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
